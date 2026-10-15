import type {
	AgentToolResult,
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { MAX_GIT_PATHS } from "../../src/constants.ts";
import { runTool, ToolError, type ToolErrorDetails } from "../../src/errors.ts";
import {
	validateGitPaths,
	validateWorkspacePath,
} from "../../src/path-policy.ts";
import { runGit } from "./run.ts";

type ToolBody<T> = AgentToolResult<T | ToolErrorDetails>;

const TIMEOUT_MS = 30_000;

export type RmCachedDetails = { removed: string[] };

export function buildRmCachedArgv(paths: string[]): string[] {
	return ["rm", "-r", "--cached", "--", ...paths];
}

/**
 * Literal workspace-relative tracked paths only. Flag-shaped, all-form, and
 * glob requests are CAPABILITY_GAP (the tool deliberately has no -A/--force/
 * --ignore-unmatch); pathspec magic and unsafe paths are rejected before any
 * spawn. Symlink escapes are caught by resolving each existing path against cwd.
 */
export function validateRmCachedPaths(paths: string[], cwd: string): string[] {
	if (paths.length > MAX_GIT_PATHS)
		throw new ToolError(
			"LIMIT_EXCEEDED",
			`too many paths (max ${MAX_GIT_PATHS})`,
		);
	for (const p of paths) {
		if (p === "." || p === "./")
			throw new ToolError(
				"CAPABILITY_GAP",
				"untracking everything is not supported; list explicit tracked paths",
				"-A/all mode",
			);
		if (p.startsWith("-"))
			throw new ToolError(
				"CAPABILITY_GAP",
				`flags are not accepted (${p}); pass workspace-relative paths only`,
				"flags",
			);
		if (/[*?[]/.test(p))
			throw new ToolError(
				"CAPABILITY_GAP",
				`globs are not supported (paths are literal): ${p}`,
				"glob expansion",
			);
		if (p.startsWith(":"))
			throw new ToolError(
				"INVALID_ARGUMENT",
				`pathspec magic is not allowed (paths are literal): ${p}`,
			);
	}
	const safe = validateGitPaths(paths, MAX_GIT_PATHS);
	for (const p of safe) validateWorkspacePath(cwd, p);
	return safe;
}

export async function executeRmCached(
	params: { paths: string[] },
	signal: AbortSignal | undefined,
	cwd: string = process.cwd(),
): Promise<ToolBody<RmCachedDetails>> {
	return runTool(async () => {
		for (const key of Object.keys(params))
			if (key !== "paths")
				throw new ToolError(
					"CAPABILITY_GAP",
					`unknown option "${key}"; git_rm_cached takes explicit paths only`,
					`git_rm_cached ${key}`,
				);
		const paths = validateRmCachedPaths(params.paths, cwd);
		const ls = await runGit(
			["ls-files", "-z", "--", ...paths],
			cwd,
			"git ls-files",
			{ timeoutMs: TIMEOUT_MS, signal, env: { GIT_LITERAL_PATHSPECS: "1" } },
		);
		const inIndex = ls.stdout.split("\0").filter((e) => e.length > 0);
		// No --ignore-unmatch: an absent path fails the git rm spawn (GIT_FAILED).
		await runGit(buildRmCachedArgv(paths), cwd, "git rm", {
			timeoutMs: TIMEOUT_MS,
			signal,
			env: { GIT_LITERAL_PATHSPECS: "1" },
		});
		const details: RmCachedDetails = { removed: inIndex };
		return {
			content: [
				{
					type: "text",
					text: `removed ${inIndex.length} index path${inIndex.length === 1 ? "" : "s"}; working tree untouched`,
				},
			],
			details,
			structuredContent: details,
		};
	});
}

const rmCachedParams = Type.Object({
	paths: Type.Array(Type.String(), {
		minItems: 1,
		maxItems: MAX_GIT_PATHS,
		description:
			"Workspace-relative tracked paths (files or directories) to remove from the index, as literal paths",
	}),
});

export const rmCachedTool: ToolDefinition<typeof rmCachedParams, unknown> = {
	name: "git_rm_cached",
	label: "Git rm --cached",
	description:
		"Remove explicit tracked paths from the Git index (untrack), leaving working-tree files untouched. Literal paths only: no globs, no all mode, no force.",
	promptSnippet:
		"Untrack paths from the git index without deleting working-tree files.",
	annotations: { readOnlyHint: false, destructiveHint: true },
	parameters: rmCachedParams,
	exposure: "direct",
	defaultActive: false,
	execute: (_id, params, signal) => executeRmCached(params, signal),
};

export function registerRmCached(pi: ExtensionAPI): void {
	pi.registerTool(rmCachedTool);
}
