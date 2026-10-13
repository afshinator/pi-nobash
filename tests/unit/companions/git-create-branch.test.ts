import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildBranchArgv,
	validateBranchName,
} from "../../../companions/git/create-branch.ts";

test("validateBranchName accepts plain branch names", () => {
	for (const name of ["feature/x", "v1.2.3", "foo_bar-baz", "main"]) {
		assert.equal(validateBranchName(name), name);
	}
});

test("validateBranchName rejects option-like, traversal, and git-refname violations", () => {
	const bad = [
		"-b",
		"--all",
		"a..b",
		"has space",
		"a~b",
		"a^b",
		"a:b",
		"a\\b",
		"a*b",
		"a?b",
		"a[b",
		".hidden",
		"trail.",
		"trail.lock",
		"trail/",
		"refs/heads/escape",
		`x${"y".repeat(255)}`, // 256 chars
		"",
	];
	for (const name of bad) {
		assert.throws(
			() => validateBranchName(name),
			(e: Error) => e.message.length > 0,
			`expected rejection for ${JSON.stringify(name)}`,
		);
	}
});

test("buildBranchArgv: create+switch is exactly git switch -c <name>", () => {
	assert.deepEqual(buildBranchArgv("topic", undefined, true), [
		"switch",
		"-c",
		"topic",
	]);
});

test("buildBranchArgv: switch from startPoint appends it", () => {
	assert.deepEqual(buildBranchArgv("topic", "abc123", true), [
		"switch",
		"-c",
		"topic",
		"abc123",
	]);
});

test("buildBranchArgv: create-only is exactly git branch <name>", () => {
	assert.deepEqual(buildBranchArgv("topic", undefined, false), [
		"branch",
		"topic",
	]);
	assert.deepEqual(buildBranchArgv("topic", "abc123", false), [
		"branch",
		"topic",
		"abc123",
	]);
});
