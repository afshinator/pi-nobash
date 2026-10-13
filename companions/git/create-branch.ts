import type {
	AgentToolResult,
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runTool, ToolError, type ToolErrorDetails } from "../../src/errors.ts";

type ToolBody<T> = AgentToolResult<T | ToolErrorDetails>;

import { validateCommitRevision } from "../../src/git/rev.ts";
import { execFixed } from "../process.ts";
import { runGit } from "./run.ts";

const TIMEOUT_MS = 30_000;
const MAX_NAME_LENGTH = 255;

// Conservative git refname rules: one charset, no traversal/range/magic tokens,
// no option-like, control, or component-edge violations, no refs/ escape.
const BRANCH_NAME_RE = /^[A-Za-z0-9._/-]+$/;

export type CreateBranchDetails = {
	branch: string;
	switchedTo: boolean;
	startPoint?: string;
};

export function validateBranchName(name: unknown): string {
	if (
		typeof name !== "string" ||
		name.length === 0 ||
		name.length > MAX_NAME_LENGTH
	)
		throw new ToolError(
			"INVALID_ARGUMENT",
			"branch name must be a non-empty string of at most 255 characters",
		);
	if (
		name.startsWith("-") ||
		name.includes("..") ||
		name.includes("@{") ||
		name.includes("refs/") ||
		!BRANCH_NAME_RE.test(name) ||
		name.startsWith(".") ||
		name.endsWith(".") ||
		name.endsWith(".lock") ||
		name.endsWith("/")
	)
		throw new ToolError(
			"INVALID_ARGUMENT",
			`branch name is not a valid git refname: ${name}`,
		);
	return name;
}

export function buildBranchArgv(
	name: string,
	startPoint: string | undefined,
	switchTo: boolean,
): string[] {
	if (switchTo) {
		const args = ["switch", "-c", name];
		if (startPoint !== undefined) args.push(startPoint);
		return args;
	}
	const args = ["branch", name];
	if (startPoint !== undefined) args.push(startPoint);
	return args;
}

export async function executeCreateBranch(
	params: {
		name: string;
		startPoint?: string;
		switchTo?: boolean;
	},
	signal: AbortSignal | undefined,
	cwd: string = process.cwd(),
): Promise<ToolBody<CreateBranchDetails>> {
	return runTool(async () => {
		const name = validateBranchName(params.name);
		const switchTo = params.switchTo ?? true;
		const exists = await execVerifyQuiet(name, cwd, signal);
		if (exists)
			throw new ToolError("INVALID_ARGUMENT", `branch already exists: ${name}`);
		let startPoint: string | undefined;
		if (params.startPoint !== undefined) {
			startPoint = await validateCommitRevision(params.startPoint, cwd);
		}
		await runGit(
			buildBranchArgv(name, startPoint, switchTo),
			cwd,
			"git switch",
			{
				timeoutMs: TIMEOUT_MS,
				signal,
			},
		);
		const details: CreateBranchDetails = {
			branch: name,
			switchedTo: switchTo,
			...(startPoint !== undefined ? { startPoint } : {}),
		};
		return {
			content: [
				{
					type: "text",
					text: `created branch ${name}${switchTo ? " (switched)" : ""}`,
				},
			],
			details,
			structuredContent: details,
		};
	});
}

async function execVerifyQuiet(
	name: string,
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<boolean> {
	// Non-zero here means "does not exist", which is not a failure.
	const out = await execFixed(
		"git",
		["rev-parse", "--verify", "--quiet", `refs/heads/${name}`],
		cwd,
		{ timeoutMs: TIMEOUT_MS, signal },
	);
	return out.code === 0;
}

const createBranchParams = Type.Object({
	name: Type.String({ description: "new branch name" }),
	startPoint: Type.Optional(
		Type.String({ description: "existing commit or branch to branch from" }),
	),
	switchTo: Type.Optional(Type.Boolean({ default: true })),
});

export const createBranchTool: ToolDefinition<
	typeof createBranchParams,
	unknown
> = {
	name: "git_create_branch",
	label: "Git create branch",
	description:
		"Create a new local branch, optionally switching to it. Nothing is staged, committed, or pushed.",
	promptSnippet: "Create a local git branch (optionally switch to it).",
	annotations: { readOnlyHint: false },
	parameters: createBranchParams,
	exposure: "direct",
	defaultActive: false,
	execute: (_id, params, signal) => executeCreateBranch(params, signal),
};

export function registerCreateBranch(pi: ExtensionAPI): void {
	pi.registerTool(createBranchTool);
}
