import assert from "node:assert/strict";
import { test } from "node:test";
import type { ValidationCheck } from "../../../src/config.ts";
import { runCheck } from "../../../src/validation/runner.ts";

const repo = process.cwd();

const targetedCheck: ValidationCheck = {
	program: "node",
	args: ["--test"],
	cwd: ".",
	timeoutMs: 60000,
	targets: {
		mode: "file",
		roots: ["tests/fixtures/validation"],
		extensions: [".test.ts"],
		runner: "node_test",
	},
};

const sleepCheck: ValidationCheck = {
	program: "node",
	args: ["-e", "setTimeout(() => {}, 30000)"],
	cwd: ".",
	timeoutMs: 300,
	targets: { mode: "none" },
};

const failCheck: ValidationCheck = {
	program: "node",
	args: ["-e", "process.exit(3)"],
	cwd: ".",
	timeoutMs: 30000,
	targets: { mode: "none" },
};

test("runner: real targeted node --test run selects exactly the fixture file", async () => {
	const result = await runCheck(
		targetedCheck,
		["tests/fixtures/validation/simple.test.ts"],
		undefined,
		repo,
	);
	assert.equal(result.exitCode, 0);
	assert.equal(result.timedOut, false);
	assert.equal(result.truncated, false);
	assert.match(result.stdout, /pass 1/);
	assert.ok(result.durationMs >= 0);
});

test("runner: nonzero exit is reported, not thrown", async () => {
	const result = await runCheck(failCheck, [], undefined, repo);
	assert.equal(result.exitCode, 3);
	assert.equal(result.timedOut, false);
});

test("runner: timeout kills the child and reports TIMEOUT", async () => {
	const result = await runCheck(sleepCheck, [], undefined, repo);
	assert.equal(result.timedOut, true);
	assert.equal(result.exitCode, null);
	assert.ok(result.durationMs < 30000);
});

test("runner: abort signal stops the child", async () => {
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 100);
	await assert.rejects(() => runCheck(sleepCheck, [], controller.signal, repo));
});

test("runner: option-like target never reaches argv unvalidated", async () => {
	await assert.rejects(
		() => runCheck(targetedCheck, ["--inject-flag"], undefined, repo),
		(e: Error) => (e as { code?: string }).code !== undefined,
	);
});
