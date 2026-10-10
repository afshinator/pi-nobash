import assert from "node:assert/strict";
import { test } from "node:test";
import type { ValidationCheck } from "../../../src/config.ts";
import { resolveAdapter } from "../../../src/validation/adapter.ts";

function fileCheck(runner: string): ValidationCheck {
	return {
		program: "node",
		args: ["--test"],
		cwd: ".",
		timeoutMs: 1000,
		targets: { mode: "file", roots: ["tests"], runner },
	};
}

test("adapter: node_test returns the verified -- suffix", () => {
	const adapter = resolveAdapter(fileCheck("node_test"));
	assert.ok(adapter);
	assert.deepEqual(
		adapter(fileCheck("node_test"), ["a.test.ts", "b.test.ts"]),
		["--", "a.test.ts", "b.test.ts"],
	);
});

test("adapter: unknown runner is rejected with INVALID_ARGUMENT before process start", () => {
	assert.throws(
		() => resolveAdapter(fileCheck("vitest")),
		(e: Error) => {
			assert.equal((e as { code?: string }).code, "INVALID_ARGUMENT");
			return true;
		},
	);
});

test("adapter: none-mode checks need no adapter", () => {
	const check: ValidationCheck = {
		program: "npm",
		args: ["run", "typecheck"],
		cwd: ".",
		timeoutMs: 1000,
		targets: { mode: "none" },
	};
	assert.equal(resolveAdapter(check), undefined);
});
