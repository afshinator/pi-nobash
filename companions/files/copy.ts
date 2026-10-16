import {
	copyFileSync,
	existsSync,
	lstatSync,
	type Stats,
	statSync,
} from "node:fs";
import path from "node:path";
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
import { validateWorkspacePath } from "../../src/path-policy.ts";

type ToolBody<T> = AgentToolResult<T | ToolErrorDetails>;

export type FsParams = { from: string; to: string };
export type FsDetails = { from: string; to: string };

/**
 * Shared fs_copy/fs_move guard: exactly { from, to }, literal relative paths.
 * Extra keys (multi-path/recursive/overwrite/flag forms) are CAPABILITY_GAP.
 * Metacharacters in a name (* ? [) are LITERAL, not globs: there is no glob
 * engine here, so "a*b.txt" names one file (issue #10).
 */
export function validateFsPair(
	cwd: string,
	params: object,
): { from: string; to: string; absFrom: string; absTo: string } {
	for (const key of Object.keys(params)) {
		if (key !== "from" && key !== "to")
			throw new ToolError(
				"CAPABILITY_GAP",
				`"${key}" is not supported: this tool takes exactly { from, to } — one path each, one operation per call`,
				key,
			);
	}
	const { from, to } = params as FsParams;
	for (const p of [from, to]) {
		if (typeof p !== "string" || p.length === 0)
			throw new ToolError(
				"INVALID_ARGUMENT",
				"from and to must be non-empty strings",
			);
	}
	// Both paths pass the workspace policy before any filesystem write.
	return {
		from,
		to,
		absFrom: validateWorkspacePath(cwd, from),
		absTo: validateWorkspacePath(cwd, to),
	};
}

/**
 * Single-path guard for fs_delete: exactly { path }, one literal relative path.
 * Extra keys (multi-path/recursive/flag forms) are CAPABILITY_GAP.
 */
export function validateFsSingle(
	cwd: string,
	params: object,
): { path: string; abs: string } {
	for (const key of Object.keys(params)) {
		if (key !== "path")
			throw new ToolError(
				"CAPABILITY_GAP",
				`"${key}" is not supported: this tool takes exactly { path } — one path, one operation per call`,
				key,
			);
	}
	const { path: p } = params as { path: string };
	if (typeof p !== "string" || p.length === 0)
		throw new ToolError("INVALID_ARGUMENT", "path must be a non-empty string");
	// The path passes the workspace policy before any filesystem change.
	return { path: p, abs: validateWorkspacePath(cwd, p) };
}

export function statSourceOrNotFound(abs: string, display: string): Stats {
	try {
		return statSync(abs);
	} catch {
		// A metacharacter miss is not "not found": the caller may have meant a
		// glob, and this tool never expands one (issue #10).
		if (/[*?[]/.test(display))
			throw new ToolError(
				"CAPABILITY_GAP",
				`no file literally named "${display}" exists; globs are not expanded (paths are literal) — pass an explicit path`,
				"glob expansion",
			);
		throw new ToolError("NOT_FOUND", `source not found: ${display}`);
	}
}

/** An existing destination is an overwrite attempt; its bytes must not change. */
export function assertDestFree(absTo: string, to: string): void {
	let st: Stats | undefined;
	try {
		st = lstatSync(absTo);
	} catch {
		return;
	}
	if (st !== undefined)
		throw new ToolError(
			"CAPABILITY_GAP",
			`destination already exists (there is no overwrite mode): ${to}`,
			"overwrite mode",
		);
}

/** The destination directory is never created implicitly: an unrequested
 * mkdir would mutate a path the model did not name. */
export function assertDestParentExists(absTo: string, to: string): void {
	if (!existsSync(path.dirname(absTo)))
		throw new ToolError(
			"NOT_FOUND",
			`destination directory does not exist: ${path.dirname(to)}`,
		);
}

export async function executeCopy(
	params: object,
	cwd: string = process.cwd(),
): Promise<ToolBody<FsDetails>> {
	return runTool(async () => {
		const { from, to, absFrom, absTo } = validateFsPair(cwd, params);
		const st = statSourceOrNotFound(absFrom, from);
		if (st.isDirectory())
			throw new ToolError(
				"CAPABILITY_GAP",
				`cannot copy a directory (there is no recursive mode): ${from}`,
				"recursive copy",
			);
		if (!st.isFile())
			throw new ToolError("INVALID_ARGUMENT", `not a regular file: ${from}`);
		assertDestFree(absTo, to);
		assertDestParentExists(absTo, to);
		copyFileSync(absFrom, absTo);
		return successResult(`copied ${from} -> ${to}`, { from, to });
	});
}

const copyParameters = Type.Object({
	from: Type.String({
		description: "Workspace-relative source: one existing regular file",
	}),
	to: Type.String({
		description: "Workspace-relative destination; must not already exist",
	}),
});

export const copyTool: ToolDefinition<
	typeof copyParameters,
	FsDetails | ToolErrorDetails
> = {
	name: "fs_copy",
	label: "Copy file",
	description:
		"Copy one regular file to a workspace-relative destination that does not already exist. Paths are literal — a name containing * ? [ names that file (no glob expansion). No recursion, no overwrite.",
	promptSnippet:
		"Copy one workspace file to a new path (no overwrite, no recursion).",
	annotations: { readOnlyHint: false, destructiveHint: true },
	parameters: copyParameters,
	exposure: "direct",
	defaultActive: false,
	execute: (_toolCallId, params, _signal, _onUpdate, ctx) =>
		executeCopy(params, ctx.cwd),
};
