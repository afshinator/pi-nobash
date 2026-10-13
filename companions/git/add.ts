import type {
	AgentToolResult,
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { MAX_GIT_PATHS } from "../../src/constants.ts";
import { runTool, ToolError, type ToolErrorDetails } from "../../src/errors.ts";

type ToolBody<T> = AgentToolResult<T | ToolErrorDetails>;

import { validateGitPaths } from "../../src/path-policy.ts";
import { execFixed } from "../process.ts";
import { runGit } from "./run.ts";

const TIMEOUT_MS = 30_000;

export type AddDetails = { staged: string[]; truncated: boolean };

type AddParams = { paths?: string[]; trackedOnly?: boolean };

export function validateAddMode(
	params: AddParams,
): { mode: "paths"; paths: string[] } | { mode: "trackedOnly" } {
	const hasPaths = params.paths !== undefined;
	if (hasPaths && params.trackedOnly === true)
		throw new ToolError(
			"INVALID_ARGUMENT",
			"paths and trackedOnly are mutually exclusive; pass one, not both",
		);
	if (!hasPaths && params.trackedOnly !== true)
		throw new ToolError(
			"INVALID_ARGUMENT",
			"pass either explicit paths or trackedOnly: true",
		);
	if (params.trackedOnly === true) return { mode: "trackedOnly" };
	return { mode: "paths", paths: validateAddPaths(params.paths ?? []) };
}

export function buildAddArgv(
	paths: string[] | undefined,
	trackedOnly?: boolean,
): string[] {
	if (trackedOnly) return ["add", "-u"];
	return ["add", "--", ...(paths ?? [])];
}

/**
 * Literal paths only: git runs with GIT_LITERAL_PATHSPECS=1, so the first
 * segment must not use pathspec magic (:(glob), :!, :(top), :/). "." would
 * stage everything — the one inclusion mode this tool deliberately lacks.
 */
export function validateAddPaths(paths: string[]): string[] {
	if (paths.length > MAX_GIT_PATHS)
		throw new ToolError(
			"LIMIT_EXCEEDED",
			`too many paths (max ${MAX_GIT_PATHS}); stage in batches or use trackedOnly`,
		);
	const firstSegment = (p: string) => p.split("/")[0] ?? "";
	for (const p of paths) {
		if (p === "." || p === "./")
			throw new ToolError(
				"CAPABILITY_GAP",
				"staging everything is not supported; list explicit paths or use trackedOnly: true",
				"git_add -A/all mode",
			);
		if (firstSegment(p).startsWith(":"))
			throw new ToolError(
				"INVALID_ARGUMENT",
				`pathspec magic is not allowed (paths are literal): ${p}`,
			);
	}
	return validateGitPaths(paths, MAX_GIT_PATHS);
}

export async function executeAdd(
	params: AddParams,
	signal: AbortSignal | undefined,
	cwd: string = process.cwd(),
): Promise<ToolBody<AddDetails>> {
	return runTool(async () => {
		const mode = validateAddMode(params);
		if (mode.mode === "paths") {
			await runGit(buildAddArgv(mode.paths), cwd, "git add", {
				timeoutMs: TIMEOUT_MS,
				signal,
				env: { GIT_LITERAL_PATHSPECS: "1" },
			});
		} else {
			await runGit(buildAddArgv(undefined, true), cwd, "git add", {
				timeoutMs: TIMEOUT_MS,
				signal,
			});
		}
		const out = await execFixed(
			"git",
			["diff", "--cached", "--name-only", "-z"],
			cwd,
			{ timeoutMs: TIMEOUT_MS, signal },
		);
		if (out.code !== 0)
			throw new ToolError(
				"GIT_FAILED",
				`listing staged files failed: ${out.stderr}`,
			);
		const all = out.stdout.split("\0").filter((entry) => entry.length > 0);
		const staged = all.slice(0, MAX_GIT_PATHS);
		const details: AddDetails = {
			staged,
			truncated: out.truncated || all.length > staged.length,
		};
		return {
			content: [
				{
					type: "text",
					text: `staged ${all.length} path${all.length === 1 ? "" : "s"}${details.truncated ? " (list truncated)" : ""}`,
				},
			],
			details,
			structuredContent: details,
		};
	});
}

const addParams = Type.Object({
	paths: Type.Optional(
		Type.Array(Type.String(), {
			minItems: 1,
			maxItems: MAX_GIT_PATHS,
			description:
				"Repo-relative paths (files or directories) to stage, as literal paths",
		}),
	),
	trackedOnly: Type.Optional(
		Type.Boolean({
			default: false,
			description:
				"Stage modifications/deletions of tracked files only; cannot add untracked files",
		}),
	),
});

export const addTool: ToolDefinition<typeof addParams, unknown> = {
	name: "git_add",
	label: "Git add",
	description:
		"Stage explicit paths (files or directories, literal paths) or, with trackedOnly, stage tracked-file changes only. There is no stage-everything mode.",
	promptSnippet:
		"Stage explicit git paths or tracked-only changes (no stage-all mode).",
	annotations: { readOnlyHint: false },
	parameters: addParams,
	exposure: "direct",
	defaultActive: false,
	execute: (_id, params, signal) => executeAdd(params, signal),
};

export function registerAdd(pi: ExtensionAPI): void {
	pi.registerTool(addTool);
}
