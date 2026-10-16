import { unlinkSync } from "node:fs";
import type {
	AgentToolResult,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	runTool,
	successResult,
	ToolError,
	type ToolErrorDetails,
} from "../../src/errors.ts";
import { statSourceOrNotFound, validateFsSingle } from "./copy.ts";

type ToolBody<T> = AgentToolResult<T | ToolErrorDetails>;

export type DeleteDetails = { path: string };

/**
 * fs_delete: delete one explicit workspace file. Directories are refused (there
 * is no recursive mode) and the operation is in-process, so it spawns nothing.
 * Same narrow contract as fs_copy: exactly one path, one operation per call.
 */
export async function executeDelete(
	params: object,
	cwd: string = process.cwd(),
): Promise<ToolBody<DeleteDetails>> {
	return runTool(async () => {
		const { path: p, abs } = validateFsSingle(cwd, params);
		const st = statSourceOrNotFound(abs, p);
		if (st.isDirectory())
			throw new ToolError(
				"CAPABILITY_GAP",
				`cannot delete a directory (there is no recursive mode): ${p}`,
				"recursive delete",
			);
		if (!st.isFile())
			throw new ToolError("INVALID_ARGUMENT", `not a regular file: ${p}`);
		unlinkSync(abs);
		return successResult(`deleted ${p}`, { path: p });
	});
}

const deleteParameters = Type.Object({
	path: Type.String({
		description:
			"Workspace-relative path of one existing regular file to delete",
	}),
});

export const deleteTool: ToolDefinition<
	typeof deleteParameters,
	DeleteDetails | ToolErrorDetails
> = {
	name: "fs_delete",
	label: "Delete file",
	description:
		"Delete one explicit workspace file. Paths are literal — a name containing * ? [ names that file (no glob expansion). No recursion, no globs, no directories.",
	promptSnippet: "Delete one workspace file (no recursion, no directories).",
	annotations: { readOnlyHint: false, destructiveHint: true },
	parameters: deleteParameters,
	exposure: "direct",
	defaultActive: false,
	execute: (_toolCallId, params, _signal, _onUpdate, ctx) =>
		executeDelete(params, ctx.cwd),
};
