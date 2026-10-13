import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildCommitArgv,
	validateCommitMessage,
} from "../../../companions/git/commit.ts";

test("buildCommitArgv: exactly git commit -m <message>", () => {
	assert.deepEqual(buildCommitArgv("fix: thing"), [
		"commit",
		"-m",
		"fix: thing",
	]);
});

test("buildCommitArgv: multi-line message stays a single argv element", () => {
	assert.deepEqual(buildCommitArgv("subject\n\nbody"), [
		"commit",
		"-m",
		"subject\n\nbody",
	]);
});

test("validateCommitMessage enforces 1..4000 characters", () => {
	assert.equal(validateCommitMessage("ok"), "ok");
	assert.throws(() => validateCommitMessage(""));
	assert.throws(() => validateCommitMessage("x".repeat(4001)));
	assert.equal(validateCommitMessage("x".repeat(4000)), "x".repeat(4000));
});
