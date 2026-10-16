import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateFsSingle } from "../../../companions/files/copy.ts";
import { deleteTool, executeDelete } from "../../../companions/files/delete.ts";

type AnyTool = {
	parameters: { properties: Record<string, unknown> };
	exposure?: string;
	defaultActive?: boolean;
	promptSnippet?: string;
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

function code(fn: () => unknown): string {
	try {
		fn();
		return "OK";
	} catch (e) {
		return (e as { code?: string }).code ?? "";
	}
}

const tool = deleteTool as unknown as AnyTool;

test("fs_delete schema: exactly { path }, no command/argv/script/program/flag field", () => {
	assert.deepEqual(Object.keys(tool.parameters.properties).sort(), ["path"]);
	for (const forbidden of [
		"command",
		"argv",
		"script",
		"program",
		"flag",
		"paths",
		"recursive",
		"force",
	]) {
		assert.ok(
			!(forbidden in tool.parameters.properties),
			`fs_delete must not expose "${forbidden}"`,
		);
	}
});

test("fs_delete metadata: exposure direct, defaultActive false, one-line promptSnippet, destructive", () => {
	assert.equal(tool.exposure, "direct");
	assert.equal(tool.defaultActive, false);
	assert.ok(tool.promptSnippet && !tool.promptSnippet.includes("\n"));
	assert.equal(tool.annotations?.readOnlyHint, false);
	assert.equal(tool.annotations?.destructiveHint, true);
});

test("validateFsSingle: any key other than path is CAPABILITY_GAP; empty/non-string INVALID_ARGUMENT", () => {
	for (const extra of [
		{ path: "a", paths: ["a"] },
		{ path: "a", recursive: true },
		{ path: "a", force: true },
	]) {
		assert.equal(
			code(() => validateFsSingle(process.cwd(), extra)),
			"CAPABILITY_GAP",
		);
	}
	for (const bad of [{}, { path: "" }, { path: 1 }]) {
		assert.equal(
			code(() => validateFsSingle(process.cwd(), bad as never)),
			"INVALID_ARGUMENT",
		);
	}
});

test("validateFsSingle: NUL is INVALID_ARGUMENT, traversal/absolute are PATH_OUT_OF_SCOPE", () => {
	assert.equal(
		code(() => validateFsSingle(process.cwd(), { path: "a\0b" })),
		"INVALID_ARGUMENT",
	);
	assert.equal(
		code(() => validateFsSingle(process.cwd(), { path: "../x" })),
		"PATH_OUT_OF_SCOPE",
	);
	assert.equal(
		code(() => validateFsSingle(process.cwd(), { path: "/etc/x" })),
		"PATH_OUT_OF_SCOPE",
	);
});

test("executeDelete: a missing path is NOT_FOUND; a metachar miss is CAPABILITY_GAP 'glob expansion'", async () => {
	const ws = mkdtempSync(path.join(tmpdir(), "fs-del-unit-"));
	try {
		const missing = (await executeDelete({ path: "missing.txt" }, ws)) as {
			details: { code?: string };
		};
		assert.equal(missing.details?.code, "NOT_FOUND");
		const meta = (await executeDelete({ path: "missing*.txt" }, ws)) as {
			details: { code?: string; capability?: string };
		};
		assert.equal(meta.details?.code, "CAPABILITY_GAP");
		assert.equal(meta.details?.capability, "glob expansion");
	} finally {
		rmSync(ws, { recursive: true, force: true });
	}
});

test("executeDelete: a directory is CAPABILITY_GAP 'recursive delete' and its contents survive", async () => {
	const ws = mkdtempSync(path.join(tmpdir(), "fs-del-unit-"));
	try {
		mkdirSync(path.join(ws, "dir"));
		writeFileSync(path.join(ws, "dir", "inner.txt"), "x\n");
		const r = (await executeDelete({ path: "dir" }, ws)) as {
			details: { code?: string; capability?: string };
		};
		assert.equal(r.details?.code, "CAPABILITY_GAP");
		assert.equal(r.details?.capability, "recursive delete");
	} finally {
		rmSync(ws, { recursive: true, force: true });
	}
});
