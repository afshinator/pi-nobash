import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadValidationConfig } from "../../../src/config.ts";

function withConfigFile(body: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), "pi-nobash-config-"));
	mkdirSync(path.join(dir, ".pi"));
	writeFileSync(path.join(dir, ".pi", "pi-nobash.json"), body);
	return dir;
}

test("config: missing file yields empty checks (config is optional)", () => {
	const empty = mkdtempSync(path.join(tmpdir(), "pi-nobash-empty-"));
	try {
		const config = loadValidationConfig(empty);
		assert.deepEqual(config.validation.checks, {});
	} finally {
		rmSync(empty, { recursive: true, force: true });
	}
});

test("config: valid file loads checks with runner field (A7 shape)", () => {
	const dir = withConfigFile(
		JSON.stringify({
			validation: {
				checks: {
					unit: {
						program: "node",
						args: ["--test"],
						cwd: ".",
						timeoutMs: 120000,
						targets: {
							mode: "file",
							roots: ["tests"],
							extensions: [".test.ts"],
							runner: "node_test",
						},
					},
					typecheck: {
						program: "npm",
						args: ["run", "typecheck"],
						cwd: ".",
						timeoutMs: 120000,
						targets: { mode: "none" },
					},
				},
			},
		}),
	);
	try {
		const config = loadValidationConfig(dir);
		const unit = config.validation.checks.unit;
		assert.ok(unit);
		assert.equal(unit.program, "node");
		assert.deepEqual(unit.args, ["--test"]);
		assert.equal(unit.targets.mode, "file");
		if (unit.targets.mode === "file") {
			assert.equal(unit.targets.runner, "node_test");
			assert.deepEqual(unit.targets.roots, ["tests"]);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("config: invalid JSON is PARSE_ERROR", () => {
	const dir = withConfigFile("{ not json");
	try {
		assert.throws(
			() => loadValidationConfig(dir),
			(e: Error) => {
				assert.equal((e as { code?: string }).code, "PARSE_ERROR");
				return true;
			},
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("config: unknown keys and malformed checks are PARSE_ERROR", () => {
	const cases: unknown[] = [
		{},
		{ validation: {} },
		{ validation: { checks: { u: { program: "node" } } } },
		{
			validation: {
				checks: {
					u: {
						program: "node",
						args: ["--test"],
						cwd: ".",
						timeoutMs: -1,
						targets: { mode: "none" },
					},
				},
			},
		},
		{
			validation: {
				checks: {
					u: {
						program: "node",
						args: ["--test"],
						cwd: ".",
						timeoutMs: 100,
						targets: { mode: "file", roots: ["t"] },
					},
				},
			},
		},
		{
			validation: {
				checks: {
					u: {
						program: "node",
						args: ["--test"],
						cwd: ".",
						timeoutMs: 100,
						targets: { mode: "bogus" },
					},
				},
			},
		},
	];
	for (const body of cases) {
		const dir = withConfigFile(JSON.stringify(body));
		try {
			assert.throws(
				() => loadValidationConfig(dir),
				(e: Error) => {
					assert.equal((e as { code?: string }).code, "PARSE_ERROR");
					return true;
				},
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});
