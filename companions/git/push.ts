import type {
	AgentToolResult,
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runTool, ToolError, type ToolErrorDetails } from "../../src/errors.ts";
import { execFixed } from "../process.ts";
import { runGit } from "./run.ts";

const TIMEOUT_MS = 300_000;

type ToolBody<T> = AgentToolResult<T | ToolErrorDetails>;

export type PushDetails = { remote: string; branch: string; pushed: true };

export function validatePushRemote(remote: unknown): string {
	if (
		typeof remote !== "string" ||
		remote.length === 0 ||
		remote.length > 100 ||
		remote.startsWith("-") ||
		/\s/.test(remote) ||
		remote.includes("://")
	)
		throw new ToolError(
			"INVALID_ARGUMENT",
			`remote must be the name of a configured git remote: ${remote}`,
		);
	return remote;
}

/**
 * Unsupported push operations (FD3): the schema cannot express them, so a
 * request carrying one is a CAPABILITY_GAP — never silently ignored.
 */
const UNSUPPORTED_PUSH_KEYS = new Set([
	"force",
	"forceWithLease",
	"refspec",
	"ref",
	"tags",
	"delete",
	"mirror",
	"prune",
	"url",
]);

function assertSupportedPush(raw: object): void {
	for (const key of Object.keys(raw)) {
		if (UNSUPPORTED_PUSH_KEYS.has(key))
			throw new ToolError(
				"CAPABILITY_GAP",
				`git_push does not support "${key}"; the schema only accepts remote (a configured remote name) and setUpstream`,
				`git_push ${key}`,
			);
	}
}

/** A URL names a remote-creation/push-to-URL operation — a gap, not a bad name. */
function validatePushRemoteArg(remote: string): string {
	if (remote.includes("://"))
		throw new ToolError(
			"CAPABILITY_GAP",
			"git_push pushes to a configured remote name only; it cannot push to a URL or create remotes",
			"git_push remote-creation",
		);
	return validatePushRemote(remote);
}

export function buildPushArgv(
	remote: string,
	branch: string,
	setUpstream: boolean,
): string[] {
	return setUpstream
		? ["push", "--set-upstream", remote, branch]
		: ["push", remote, branch];
}

export async function executePush(
	params: { remote?: string; setUpstream?: boolean },
	signal: AbortSignal | undefined,
	cwd: string = process.cwd(),
): Promise<ToolBody<PushDetails>> {
	return runTool(async () => {
		assertSupportedPush(params);
		const remote =
			params.remote !== undefined
				? validatePushRemoteArg(params.remote)
				: "origin";
		const branchOut = await execFixed(
			"git",
			["rev-parse", "--abbrev-ref", "HEAD"],
			cwd,
			{ timeoutMs: TIMEOUT_MS, signal },
		);
		const branch = branchOut.stdout.trim();
		if (branchOut.code !== 0 || branch === "HEAD")
			throw new ToolError(
				"GIT_FAILED",
				"detached HEAD; switch to a branch first",
			);
		if (params.remote !== undefined) {
			const remotes = await execFixed("git", ["remote"], cwd, {
				timeoutMs: TIMEOUT_MS,
				signal,
			});
			if (remotes.code !== 0)
				throw new ToolError(
					"GIT_FAILED",
					`git remote failed: ${remotes.stderr}`,
				);
			const known = remotes.stdout.split("\n").map((r) => r.trim());
			if (!known.includes(remote))
				throw new ToolError(
					"INVALID_ARGUMENT",
					`no configured remote named ${remote}; remotes: ${known.filter((r) => r.length > 0).join(", ") || "none"}`,
				);
		}
		const setUpstream = params.setUpstream ?? false;
		if (!setUpstream) {
			const upstream = await execFixed(
				"git",
				[
					"rev-parse",
					"--abbrev-ref",
					"--symbolic-full-name",
					`${branch}@{upstream}`,
				],
				cwd,
				{ timeoutMs: TIMEOUT_MS, signal },
			);
			if (upstream.code !== 0)
				throw new ToolError(
					"GIT_FAILED",
					`no upstream for ${branch}; pass setUpstream: true or run git push --set-upstream once`,
				);
		}
		// Fixed argv: branch name only, no refspec, no force, no tags, no URL.
		await runGit(buildPushArgv(remote, branch, setUpstream), cwd, "git push", {
			timeoutMs: TIMEOUT_MS,
			signal,
		});
		const details: PushDetails = { remote, branch, pushed: true };
		return {
			content: [{ type: "text", text: `pushed ${branch} to ${remote}` }],
			details,
			structuredContent: details,
		};
	});
}

const pushParams = Type.Object({
	remote: Type.Optional(
		Type.String({
			maxLength: 100,
			description: "Configured remote name (default origin); never a URL",
		}),
	),
	setUpstream: Type.Optional(
		Type.Boolean({
			default: false,
			description: "Set upstream tracking on first push of the branch",
		}),
	),
});

export const pushTool: ToolDefinition<typeof pushParams, unknown> = {
	name: "git_push",
	label: "Git push",
	description:
		"Push the current branch to a configured remote. No force, no refspec, no tags, no remote creation.",
	promptSnippet: "Push the current branch to a configured remote (no force).",
	annotations: { readOnlyHint: false, destructiveHint: true },
	parameters: pushParams,
	exposure: "direct",
	defaultActive: false,
	execute: (_id, params, signal) => executePush(params, signal),
};

export function registerPush(pi: ExtensionAPI): void {
	pi.registerTool(pushTool);
}
