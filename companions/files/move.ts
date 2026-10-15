import { renameSync } from "node:fs";
import type {
	AgentToolResult,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	runTool,
	successResult,
	type ToolErrorDetails,
} from "../../src/errors.ts";
import {
	assertDestFree,
	assertDestParentExists,
	type FsDetails,
	statSourceOrNotFound,
	validateFsPair,
} from "./copy.ts";

type ToolBody<T> = AgentToolResult<T | ToolErrorDetails>;

export async function executeMove(
	params: object,
	cwd: string = process.cwd(),
): Promise<ToolBody<FsDetails>> {
	return runTool(async () => {
		const { from, to, absFrom, absTo } = validateFsPair(cwd, params);
		// A plain rename: files and directories both move without copying
		// contents, and never recursively across a directory boundary.
		statSourceOrNotFound(absFrom, from);
		assertDestFree(absTo, to);
		assertDestParentExists(absTo, to);
		renameSync(absFrom, absTo);
		return successResult(`moved ${from} -> ${to}`, { from, to });
	});
}

const moveParameters = Type.Object({
	from: Type.String({
		description: "Workspace-relative source: one existing file or directory",
	}),
	to: Type.String({
		description: "Workspace-relative destination; must not already exist",
	}),
});

export const moveTool: ToolDefinition<
	typeof moveParameters,
	FsDetails | ToolErrorDetails
> = {
	name: "fs_move",
	label: "Move file or directory",
	description:
		"Rename one file or directory within the workspace (single in-place rename, no content copy). The destination must not already exist; no globs, no overwrite.",
	promptSnippet:
		"Rename or move one workspace file or directory (no overwrite).",
	annotations: { readOnlyHint: false, destructiveHint: true },
	parameters: moveParameters,
	exposure: "direct",
	defaultActive: false,
	execute: (_toolCallId, params, _signal, _onUpdate, ctx) =>
		executeMove(params, ctx.cwd),
};
