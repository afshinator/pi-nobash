import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildAddArgv,
	validateAddMode,
	validateAddPaths,
} from "../../../companions/git/add.ts";

test("buildAddArgv: explicit paths are exactly git add -- <paths>", () => {
	assert.deepEqual(buildAddArgv(["a.txt", "src/b.ts"]), [
		"add",
		"--",
		"a.txt",
		"src/b.ts",
	]);
});

test("buildAddArgv: trackedOnly is exactly git add -u", () => {
	assert.deepEqual(buildAddArgv(undefined, true), ["add", "-u"]);
});

test("validateAddPaths passes through safe relative paths", () => {
	assert.deepEqual(validateAddPaths(["a.txt", "src/b.ts"]), [
		"a.txt",
		"src/b.ts",
	]);
});

test("validateAddPaths rejects traversal, absolute, NUL, option-like segments", () => {
	for (const p of ["../x", "/etc/passwd", "a\0b", "dir/-flag"]) {
		assert.throws(() => validateAddPaths([p]));
	}
});

test("validateAddPaths rejects leading-: pathspec magic", () => {
	for (const p of [":(glob)x", ":!secret", ":(top)y", ":/z"]) {
		assert.throws(
			() => validateAddPaths([p]),
			(e: Error) => e.message.includes(p),
		);
	}
});

test("validateAddPaths: '.' (stage everything) is CAPABILITY_GAP, not INVALID_ARGUMENT", () => {
	assert.throws(
		() => validateAddPaths(["."]),
		(e: Error & { code?: string }) => {
			assert.equal(e.code, "CAPABILITY_GAP");
			return true;
		},
	);
});

test("validateAddPaths: 101 paths is LIMIT_EXCEEDED", () => {
	const paths = Array.from({ length: 101 }, (_, i) => `f${i}.txt`);
	assert.throws(
		() => validateAddPaths(paths),
		(e: Error & { code?: string }) => {
			assert.equal(e.code, "LIMIT_EXCEEDED");
			return true;
		},
	);
	assert.deepEqual(validateAddPaths(paths.slice(0, 100)), paths.slice(0, 100));
});

test("validateAddMode: paths and trackedOnly are mutually exclusive", () => {
	assert.throws(
		() => validateAddMode({ paths: ["a"], trackedOnly: true }),
		(e: Error & { code?: string }) => {
			assert.equal(e.code, "INVALID_ARGUMENT");
			return true;
		},
	);
	assert.throws(
		() => validateAddMode({}),
		(e: Error & { code?: string }) => {
			assert.equal(e.code, "INVALID_ARGUMENT");
			return true;
		},
	);
	assert.deepEqual(validateAddMode({ paths: ["a"] }), {
		mode: "paths",
		paths: ["a"],
	});
	assert.deepEqual(validateAddMode({ trackedOnly: true }), {
		mode: "trackedOnly",
	});
});
