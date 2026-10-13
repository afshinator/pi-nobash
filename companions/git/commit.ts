import type {
	AgentToolResult,
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runTool, ToolError, type ToolErrorDetails } from "../../src/errors.ts";

type ToolBody<T> = AgentToolResult<T | ToolErrorDetails>;

import { execFixed } from "../process.ts";
import { runGit } from "./run.ts";

const TIMEOUT_MS = 120_000;
const MAX_MESSAGE_LENGTH = 4000;

export type CommitDetails = {
	hash: string;
	shortHash: string;
	branch: string | null;
	filesCommitted: number;
	message: string;
};

export function validateCommitMessage(message: unknown): string {
	if (
		typeof message !== "string" ||
		message.length < 1 ||
		message.length > MAX_MESSAGE_LENGTH
	)
		throw new ToolError(
			"INVALID_ARGUMENT",
			`message must be a string of 1 to ${MAX_MESSAGE_LENGTH} characters`,
		);
	return message;
}

export function buildCommitArgv(message: string): string[] {
	return ["commit", "-m", message];
}

export async function executeCommit(
	params: { message: string },
	signal: AbortSignal | undefined,
	cwd: string = process.cwd(),
): Promise<ToolBody<CommitDetails>> {
	return runTool(async () => {
		const message = validateCommitMessage(params.message);
		const staged = await execFixed(
			"git",
			["diff", "--cached", "--name-only"],
			cwd,
			{ timeoutMs: TIMEOUT_MS, signal },
		);
		if (staged.code !== 0)
			throw new ToolError(
				"GIT_FAILED",
				`checking the staged index failed: ${staged.stderr}`,
			);
		const files = staged.stdout.split("\n").filter((l) => l.length > 0);
		if (files.length === 0)
			throw new ToolError(
				"INVALID_ARGUMENT",
				"nothing staged; stage paths with git_add first",
			);
		await runGit(buildCommitArgv(message), cwd, "git commit", {
			timeoutMs: TIMEOUT_MS,
			signal,
		});
		const head = await runGit(["rev-parse", "HEAD"], cwd, "git rev-parse", {
			timeoutMs: TIMEOUT_MS,
			signal,
		});
		const short = await runGit(
			["rev-parse", "--short", "HEAD"],
			cwd,
			"git rev-parse",
			{
				timeoutMs: TIMEOUT_MS,
				signal,
			},
		);
		const branchOut = await execFixed(
			"git",
			["rev-parse", "--abbrev-ref", "HEAD"],
			cwd,
			{ timeoutMs: TIMEOUT_MS, signal },
		);
		const branchName = branchOut.code === 0 ? branchOut.stdout.trim() : "HEAD";
		const details: CommitDetails = {
			hash: head.stdout.trim(),
			shortHash: short.stdout.trim(),
			branch: branchName === "HEAD" ? null : branchName,
			filesCommitted: files.length,
			message,
		};
		return {
			content: [
				{
					type: "text",
					text: `committed ${details.shortHash} on ${details.branch ?? "(detached)"}: ${files.length} file${files.length === 1 ? "" : "s"}`,
				},
			],
			details,
			structuredContent: details,
		};
	});
}

const commitParams = Type.Object({
	message: Type.String({ minLength: 1, maxLength: MAX_MESSAGE_LENGTH }),
});

export const commitTool: ToolDefinition<typeof commitParams, unknown> = {
	name: "git_commit",
	label: "Git commit",
	description:
		"Commit the staged index with a required message. Never stages, amends, or bypasses hooks.",
	promptSnippet: "Commit the staged index with a message (no auto-stage).",
	annotations: { readOnlyHint: false },
	parameters: commitParams,
	exposure: "direct",
	defaultActive: false,
	execute: (_id, params, signal) => executeCommit(params, signal),
};

export function registerCommit(pi: ExtensionAPI): void {
	pi.registerTool(commitTool);
}
