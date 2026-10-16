import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	copyTool,
	statSourceOrNotFound,
	validateFsPair,
} from "../../../companions/files/copy.ts";

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

function capability(fn: () => unknown): string {
	try {
		fn();
		return "";
	} catch (e) {
		return (e as { capability?: string }).capability ?? "";
	}
}

const tool = copyTool as unknown as AnyTool;

test("fs_copy schema: exactly { from, to }, no command/argv/script/program/flag field", () => {
	const keys = Object.keys(tool.parameters.properties).sort();
	assert.deepEqual(keys, ["from", "to"]);
	for (const forbidden of [
		"command",
		"argv",
		"script",
		"program",
		"flag",
		"paths",
		"recursive",
		"overwrite",
		"force",
	]) {
		assert.ok(
			!(forbidden in tool.parameters.properties),
			`fs_copy must not expose "${forbidden}"`,
		);
	}
});

test("fs_copy metadata: exposure direct, defaultActive false, one-line promptSnippet, destructive", () => {
	assert.equal(tool.exposure, "direct");
	assert.equal(tool.defaultActive, false);
	assert.ok(tool.promptSnippet && !tool.promptSnippet.includes("\n"));
	assert.equal(tool.annotations?.readOnlyHint, false);
	assert.equal(tool.annotations?.destructiveHint, true);
});

test("validateFsPair: any key other than from/to is CAPABILITY_GAP", () => {
	for (const extra of [
		{ from: "a", to: "b", recursive: true },
		{ from: "a", to: "b", overwrite: true },
		{ from: "a", to: "b", force: true },
		{ from: "a", to: "b", paths: ["a"] },
	]) {
		assert.equal(
			code(() => validateFsPair(process.cwd(), extra)),
			"CAPABILITY_GAP",
		);
	}
});

test("validateFsPair: glob metachars are literal paths, not a capability gap (issue #10)", () => {
	for (const p of ["a*.txt", "a?b", "a[b]", "dir/*"]) {
		const r = validateFsPair(process.cwd(), { from: p, to: "b" });
		assert.equal(r.from, p);
		assert.equal(r.to, "b");
	}
});

test("statSourceOrNotFound: a metachar miss is CAPABILITY_GAP 'glob expansion'; a plain miss is NOT_FOUND (issue #10)", () => {
	const missing = path.join(tmpdir(), "pi-nobash-issue10-missing");
	assert.equal(
		code(() => statSourceOrNotFound(path.join(missing, "a*.txt"), "a*.txt")),
		"CAPABILITY_GAP",
	);
	assert.equal(
		capability(() =>
			statSourceOrNotFound(path.join(missing, "a*.txt"), "a*.txt"),
		),
		"glob expansion",
	);
	assert.equal(
		code(() =>
			statSourceOrNotFound(path.join(missing, "plain.txt"), "plain.txt"),
		),
		"NOT_FOUND",
	);
});

test("validateFsPair: NUL is INVALID_ARGUMENT, traversal/absolute are PATH_OUT_OF_SCOPE", () => {
	assert.equal(
		code(() => validateFsPair(process.cwd(), { from: "a\0b", to: "b" })),
		"INVALID_ARGUMENT",
	);
	assert.equal(
		code(() => validateFsPair(process.cwd(), { from: "../x", to: "b" })),
		"PATH_OUT_OF_SCOPE",
	);
	assert.equal(
		code(() => validateFsPair(process.cwd(), { from: "a", to: "/etc/x" })),
		"PATH_OUT_OF_SCOPE",
	);
});

test("validateFsPair: non-string or empty from/to is INVALID_ARGUMENT", () => {
	for (const bad of [
		{ from: "", to: "b" },
		{ to: "b" },
		{ from: 1, to: "b" },
		{ from: "a", to: "" },
	]) {
		assert.equal(
			code(() => validateFsPair(process.cwd(), bad as never)),
			"INVALID_ARGUMENT",
		);
	}
});

test("validateFsPair: safe relative paths keep their relative form", () => {
	const r = validateFsPair(process.cwd(), { from: "a.txt", to: "src/b.txt" });
	assert.deepEqual(
		{ from: r.from, to: r.to },
		{ from: "a.txt", to: "src/b.txt" },
	);
});
