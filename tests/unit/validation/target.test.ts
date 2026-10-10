import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { ValidationCheck } from "../../../src/config.ts";
import { resolveTargets } from "../../../src/validation/target.ts";

const dirs: string[] = [];
function makeWorkspace(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "pi-nobash-targets-"));
	dirs.push(dir);
	mkdirSync(path.join(dir, "tests", "nested"), { recursive: true });
	mkdirSync(path.join(dir, "src"));
	writeFileSync(path.join(dir, "tests", "a.test.ts"), "export {};\n");
	writeFileSync(path.join(dir, "tests", "nested", "b.test.ts"), "export {};\n");
	writeFileSync(path.join(dir, "tests", "notes.txt"), "x\n");
	writeFileSync(path.join(dir, "outside.test.ts"), "export {};\n");
	return dir;
}
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fileCheck(
	overrides: Partial<
		Extract<ValidationCheck["targets"], { mode: "file" }>
	> = {},
): ValidationCheck {
	return {
		program: "node",
		args: ["--test"],
		cwd: ".",
		timeoutMs: 1000,
		targets: {
			mode: "file",
			roots: ["tests"],
			extensions: [".test.ts"],
			runner: "node_test",
			...overrides,
		},
	};
}

function codeOf(fn: () => unknown): string {
	try {
		fn();
	} catch (e) {
		return (e as { code?: string }).code ?? "NO_CODE";
	}
	return "NO_THROW";
}

test("target: valid target resolves to a cwd-relative path", () => {
	const ws = makeWorkspace();
	assert.deepEqual(resolveTargets(fileCheck(), ["tests/a.test.ts"], ws), [
		"tests/a.test.ts",
	]);
});

test("target: nested target under root resolves", () => {
	const ws = makeWorkspace();
	assert.deepEqual(
		resolveTargets(fileCheck(), ["tests/nested/b.test.ts"], ws),
		["tests/nested/b.test.ts"],
	);
});

test("target: rejects for none-mode checks, missing files, directories, extension mismatch, option-like names", () => {
	const ws = makeWorkspace();
	const noneCheck: ValidationCheck = {
		...fileCheck(),
		targets: { mode: "none" },
	};
	assert.equal(
		codeOf(() => resolveTargets(noneCheck, ["tests/a.test.ts"], ws)),
		"INVALID_ARGUMENT",
	);
	assert.equal(
		codeOf(() => resolveTargets(fileCheck(), ["tests/missing.test.ts"], ws)),
		"INVALID_ARGUMENT",
	);
	assert.equal(
		codeOf(() => resolveTargets(fileCheck(), ["tests"], ws)),
		"INVALID_ARGUMENT",
	);
	assert.equal(
		codeOf(() => resolveTargets(fileCheck(), ["tests/notes.txt"], ws)),
		"INVALID_ARGUMENT",
	);
	assert.equal(
		codeOf(() => resolveTargets(fileCheck(), ["tests/-weird.test.ts"], ws)),
		"INVALID_ARGUMENT",
	);
});

test("target: traversal outside roots is PATH_OUT_OF_SCOPE", () => {
	const ws = makeWorkspace();
	assert.equal(
		codeOf(() => resolveTargets(fileCheck(), ["outside.test.ts"], ws)),
		"PATH_OUT_OF_SCOPE",
	);
	assert.equal(
		codeOf(() => resolveTargets(fileCheck(), ["../escape.test.ts"], ws)),
		"PATH_OUT_OF_SCOPE",
	);
});

test("target: symlink resolving outside any root is rejected (spec 18.3)", () => {
	const ws = makeWorkspace();
	const outside = mkdtempSync(path.join(tmpdir(), "pi-nobash-evil-"));
	dirs.push(outside);
	writeFileSync(path.join(outside, "evil.test.ts"), "export {};\n");
	symlinkSync(
		path.join(outside, "evil.test.ts"),
		path.join(ws, "tests", "link.test.ts"),
	);
	assert.equal(
		codeOf(() => resolveTargets(fileCheck(), ["tests/link.test.ts"], ws)),
		"PATH_OUT_OF_SCOPE",
	);
});

test("target: more than 50 targets is LIMIT_EXCEEDED", () => {
	const ws = makeWorkspace();
	const fiftyOne = Array.from({ length: 51 }, () => "tests/a.test.ts");
	assert.equal(
		codeOf(() => resolveTargets(fileCheck(), fiftyOne, ws)),
		"LIMIT_EXCEEDED",
	);
});

test("target: exact-listed file is approved even outside roots", () => {
	const ws = makeWorkspace();
	assert.deepEqual(
		resolveTargets(
			fileCheck({ exact: ["outside.test.ts"] }),
			["outside.test.ts"],
			ws,
		),
		["outside.test.ts"],
	);
});
