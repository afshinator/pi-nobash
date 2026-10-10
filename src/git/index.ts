import type {
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { gitDiff, gitLog, gitShow, gitStatus } from "./tools.ts";

const MAX_PATHS = 50;

const pathsParam = Type.Optional(
	Type.Array(Type.String(), {
		maxItems: MAX_PATHS,
		description: "Optional path filter",
	}),
);

const gitStatusParams = Type.Object({
	paths: pathsParam,
	includeUntracked: Type.Optional(
		Type.Boolean({ description: "Include untracked files (default true)" }),
	),
});

const gitDiffParams = Type.Object({
	mode: Type.Union([
		Type.Literal("working"),
		Type.Literal("staged"),
		Type.Literal("commit"),
	]),
	revision: Type.Optional(
		Type.String({ description: 'Commit-ish; only allowed with mode "commit"' }),
	),
	paths: pathsParam,
	contextLines: Type.Optional(
		Type.Integer({ minimum: 0, maximum: 100, default: 3 }),
	),
});

const gitLogParams = Type.Object({
	maxEntries: Type.Optional(
		Type.Integer({ minimum: 1, maximum: 200, default: 50 }),
	),
	paths: pathsParam,
});

const gitShowParams = Type.Object({
	revision: Type.String({ description: "Commit-ish to show" }),
	paths: pathsParam,
});

export const gitStatusTool: ToolDefinition<typeof gitStatusParams, unknown> = {
	name: "git_status",
	label: "Git status",
	description:
		"Read-only normalized git status: branch, HEAD, and file status entries.",
	parameters: gitStatusParams,
	exposure: "direct",
	defaultActive: false,
	execute: (_id, params, signal) => gitStatus(params, signal),
};

export const gitDiffTool: ToolDefinition<typeof gitDiffParams, unknown> = {
	name: "git_diff",
	label: "Git diff",
	description: "Read-only git diff: working tree, staged, or against a commit.",
	parameters: gitDiffParams,
	exposure: "direct",
	defaultActive: false,
	execute: (_id, params, signal) => gitDiff(params, signal),
};

export const gitLogTool: ToolDefinition<typeof gitLogParams, unknown> = {
	name: "git_log",
	label: "Git log",
	description: "Read-only bounded git log with fixed fields.",
	parameters: gitLogParams,
	exposure: "direct",
	defaultActive: false,
	execute: (_id, params, signal) => gitLog(params, signal),
};

export const gitShowTool: ToolDefinition<typeof gitShowParams, unknown> = {
	name: "git_show",
	label: "Git show",
	description: "Read-only single-commit inspection: metadata and diff.",
	parameters: gitShowParams,
	exposure: "direct",
	defaultActive: false,
	execute: (_id, params, signal) => gitShow(params, signal),
};

export function registerGitTools(pi: ExtensionAPI): void {
	pi.registerTool(gitStatusTool);
	pi.registerTool(gitDiffTool);
	pi.registerTool(gitLogTool);
	pi.registerTool(gitShowTool);
}
