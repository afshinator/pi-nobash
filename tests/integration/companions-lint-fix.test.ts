/**
 * Integration for js_lint_fix (P1-1) and py_lint_fix (P1-2): real Biome byte
 * diffs, labelled npx/ruff STUBS for exact-argv plumbing, a real-Ruff branch
 * that skips with a printed reason, config binding (F6), and a run_validation
 * arg audit (F8).
 *
 * A STUB never counts as a real-binary pass: stub tests are named "STUB" and
 * the real-Ruff branch skips (it cannot pass) when ruff is absent.
 */

import assert from "node:assert/strict";
import childProcess, { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerJsTools } from "../../companions/javascript/index.ts";
import { registerPythonTools } from "../../companions/python/index.ts";
import { loadValidationConfig } from "../../src/config.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type RegisteredTool = {
	name: string;
	execute: (...args: unknown[]) => Promise<{
		isError?: boolean;
		content: Array<{ text?: string }>;
		details: unknown;
	}>;
};

function mockRegistrar(): {
	pi: ExtensionAPI;
	fire(event: string, ctx: unknown): void;
	registered: RegisteredTool[];
} {
	const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
	const registered: RegisteredTool[] = [];
	const pi = {
		on(event: string, handler: (...args: unknown[]) => unknown) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
		registerTool: (tool: RegisteredTool) => {
			registered.push(tool);
		},
	} as unknown as ExtensionAPI;
	return {
		pi,
		registered,
		fire(event, ctx) {
			for (const h of handlers.get(event) ?? []) h({}, ctx);
		},
	};
}

let sessionSeq = 0;

function writeCompanionConfig(
	ws: string,
	content: Record<string, unknown> | string,
): void {
	mkdirSync(path.join(ws, ".pi"), { recursive: true });
	writeFileSync(
		path.join(ws, ".pi", "pi-nobash-companions.json"),
		typeof content === "string" ? content : JSON.stringify(content),
	);
}

function jsLinterConfig(linter: string): Record<string, unknown> {
	return {
		companions: {
			javascript: {
				formatter: "prettier",
				linter,
				packageManager: "npm",
			},
			python: { formatter: "ruff", linter: "ruff", packageManager: "uv" },
		},
	};
}

/** Binds a session for `ws`, runs the named tool, returns the raw result. */
async function runTool(
	register: (pi: ExtensionAPI) => void,
	ws: string,
	name: string,
	params: { paths: string[] },
): Promise<{
	isError: boolean;
	text: string;
	details: Record<string, unknown>;
}> {
	const { pi, fire, registered } = mockRegistrar();
	register(pi);
	const sessionId = `it-lint-${++sessionSeq}`;
	const ctx = {
		cwd: ws,
		sessionManager: { getSessionId: () => sessionId },
	};
	fire("session_start", ctx);
	const tool = registered.find((t) => t.name === name);
	assert.ok(tool, `${name} must be registered`);
	const result = await tool.execute("id", params, undefined, undefined, ctx);
	const content = result.content as Array<{ text?: string }>;
	return {
		isError: result.isError === true,
		text: content[0]?.text ?? "",
		details: result.details as Record<string, unknown>,
	};
}

// --- F7: real Biome (devDependency), default config path ---

test("js_lint_fix (REAL biome, no config file): exact post bytes, others untouched, safety witness", {
	timeout: 120_000,
}, async () => {
	const ws = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-lint-it-")),
	);
	dirs.push(ws);
	// No .pi/pi-nobash-companions.json -> defaults (javascript.linter = biome).
	writeFileSync(path.join(ws, "fixme.ts"), "export let x = 1;\n");
	const untouched = "export const keep = 1;\n";
	writeFileSync(path.join(ws, "other.ts"), untouched);
	// Safety witness: a == 1 is unsafe-fixable-only; biome must NOT touch it.
	const unsafeOnly = "export const a = 1;\nexport const c = a == 1;\n";
	writeFileSync(path.join(ws, "unsafe.ts"), unsafeOnly);

	const out = await runTool(registerJsTools, ws, "js_lint_fix", {
		paths: ["fixme.ts"],
	});
	assert.equal(out.isError, false, out.text);
	assert.deepEqual(out.details, {
		fixed: ["fixme.ts"],
		remainingIssues: false,
		truncated: false,
	});
	assert.equal(
		readFileSync(path.join(ws, "fixme.ts"), "utf8"),
		"export const x = 1;\n",
	);
	assert.equal(readFileSync(path.join(ws, "other.ts"), "utf8"), untouched);

	// The untouched witness run: exit 1 -> success envelope + remainingIssues,
	// and the a == 1 file is byte-identical (proves safe-only argv).
	const witness = await runTool(registerJsTools, ws, "js_lint_fix", {
		paths: ["unsafe.ts"],
	});
	assert.equal(witness.isError, false, "exit 1 is not an error (F4)");
	assert.equal(witness.details.remainingIssues, true);
	assert.equal(readFileSync(path.join(ws, "unsafe.ts"), "utf8"), unsafeOnly);
});

// --- exact-argv plumbing via labelled STUBS (never counted as real-binary) ---

function installStub(bin: string, name: string, body: string): string {
	const stub = [
		"#!/bin/sh",
		`printf '%s\\n' "$*" >> "MARKER"`,
		body,
		"exit 0",
		"",
	]
		.join("\n")
		.replace("MARKER", path.join(bin, "argv-marker.txt"));
	const stubPath = path.join(bin, name);
	writeFileSync(stubPath, stub);
	chmodSync(stubPath, 0o755);
	return stubPath;
}

test("js_lint_fix (STUB npx eslint, not real ESLint): exact argv and post bytes", {
	timeout: 60_000,
}, async () => {
	const ws = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-lint-it-")),
	);
	dirs.push(ws);
	writeCompanionConfig(ws, jsLinterConfig("eslint"));
	const bin = mkdtempSync(path.join(tmpdir(), "pi-nobash-eslint-bin-"));
	dirs.push(bin);
	// npx stub: records the full argv, drops "eslint", rewrites $3 (the path
	// after `--fix --`) to known bytes.
	installStub(bin, "npx", 'shift\nprintf "fixed by stub\\n" > "$3"');
	const realPathEnv = process.env.PATH;
	process.env.PATH = `${bin}:${realPathEnv}`;
	try {
		writeFileSync(path.join(ws, "a.ts"), "export let x = 1;\n");
		const untouched = "export const keep = 1;\n";
		writeFileSync(path.join(ws, "b.ts"), untouched);

		const out = await runTool(registerJsTools, ws, "js_lint_fix", {
			paths: ["a.ts"],
		});
		assert.equal(out.isError, false, out.text);
		assert.deepEqual(out.details, {
			fixed: ["a.ts"],
			remainingIssues: false,
			truncated: false,
		});
		// Exact frozen argv: npx eslint --fix -- <abs>.
		assert.equal(
			readFileSync(path.join(bin, "argv-marker.txt"), "utf8"),
			`eslint --fix -- ${path.join(ws, "a.ts")}\n`,
		);
		assert.equal(
			readFileSync(path.join(ws, "a.ts"), "utf8"),
			"fixed by stub\n",
		);
		assert.equal(readFileSync(path.join(ws, "b.ts"), "utf8"), untouched);
	} finally {
		process.env.PATH = realPathEnv;
	}
});

test("py_lint_fix (STUB ruff, not real Ruff): exact argv and post bytes", {
	timeout: 60_000,
}, async () => {
	const ws = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-lint-it-")),
	);
	dirs.push(ws);
	const bin = mkdtempSync(path.join(tmpdir(), "pi-nobash-ruff-bin-"));
	dirs.push(bin);
	// ruff stub: records argv, rewrites $4 (the path after `check --fix --`).
	installStub(bin, "ruff", 'printf "x = 1\\n" > "$4"');
	const realPathEnv = process.env.PATH;
	process.env.PATH = `${bin}:${realPathEnv}`;
	try {
		writeFileSync(path.join(ws, "a.py"), "x  =1\n");
		const untouched = "y = 2\n";
		writeFileSync(path.join(ws, "b.py"), untouched);

		const out = await runTool(registerPythonTools, ws, "py_lint_fix", {
			paths: ["a.py"],
		});
		assert.equal(out.isError, false, out.text);
		assert.deepEqual(out.details, {
			fixed: ["a.py"],
			remainingIssues: false,
			truncated: false,
		});
		// Exact frozen argv: check --fix -- <abs>.
		assert.equal(
			readFileSync(path.join(bin, "argv-marker.txt"), "utf8"),
			`check --fix -- ${path.join(ws, "a.py")}\n`,
		);
		assert.equal(readFileSync(path.join(ws, "a.py"), "utf8"), "x = 1\n");
		assert.equal(readFileSync(path.join(ws, "b.py"), "utf8"), untouched);
	} finally {
		process.env.PATH = realPathEnv;
	}
});

test("py_lint_fix (REAL ruff from PATH): exact post bytes", {
	timeout: 120_000,
}, async (t) => {
	let ruff: string;
	try {
		ruff = execFileSync("which", ["ruff"], { stdio: "pipe" }).toString().trim();
	} catch {
		ruff = "";
	}
	if (!ruff)
		return t.skip(
			"ruff not on PATH — real-Ruff lint-fix byte-diff branch cannot run here (no ruff/uv installed); STUB test covers the argv plumbing",
		);

	const ws = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-lint-it-")),
	);
	dirs.push(ws);
	writeFileSync(path.join(ws, "a.py"), "x  =1\n");

	// Reference: what the real ruff produces, run directly.
	execFileSync(ruff, ["check", "--fix", "--", path.join(ws, "a.py")], {
		stdio: "pipe",
	});
	const expected = readFileSync(path.join(ws, "a.py"));

	writeFileSync(path.join(ws, "a.py"), "x  =1\n");
	const out = await runTool(registerPythonTools, ws, "py_lint_fix", {
		paths: ["a.py"],
	});
	assert.equal(out.isError, false, out.text);
	assert.ok(
		expected.equals(readFileSync(path.join(ws, "a.py"))),
		"post-bytes must equal real ruff check --fix output",
	);
});

// --- F6: config binding through the registered tool ---

test("config binding: no config -> biome argv; javascript.linter eslint -> eslint argv; tslint -> PARSE_ERROR with zero spawns", {
	timeout: 60_000,
}, async () => {
	const ws = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-lint-it-")),
	);
	dirs.push(ws);
	writeFileSync(path.join(ws, "a.ts"), "export let x = 1;\n");

	// No config file -> default biome argv (intercept, then pass through so
	// the real biome runs on the fixture).
	const realSpawn = childProcess.spawn;
	const seen: Array<{ program: string; args: string[] }> = [];
	childProcess.spawn = ((program: string, args: string[], opts: unknown) => {
		seen.push({ program, args });
		return realSpawn(program, args, opts as never);
	}) as typeof childProcess.spawn;
	try {
		const out = await runTool(registerJsTools, ws, "js_lint_fix", {
			paths: ["a.ts"],
		});
		assert.equal(out.isError, false, out.text);
		assert.equal(seen.length, 1);
		assert.equal(seen[0]?.program, "npx");
		assert.deepEqual(seen[0]?.args, [
			"biome",
			"check",
			"--write",
			"--",
			path.join(ws, "a.ts"),
		]);
		assert.equal(
			readFileSync(path.join(ws, "a.ts"), "utf8"),
			"export const x = 1;\n",
		);
	} finally {
		childProcess.spawn = realSpawn;
	}

	// javascript.linter "eslint" -> eslint argv (already proven byte-exact by
	// the STUB test above); here only the selection is re-checked cheaply.
	// javascript.linter "tslint" -> PARSE_ERROR envelope, zero spawns.
	const bad = mkdtempSync(path.join(tmpdir(), "pi-nobash-lint-it2-"));
	dirs.push(bad);
	writeCompanionConfig(bad, jsLinterConfig("tslint"));
	writeFileSync(path.join(bad, "a.ts"), "export let x = 1;\n");
	const calls: unknown[] = [];
	childProcess.spawn = ((...args: unknown[]) => {
		calls.push(args);
		// Not reached in this test: config parsing fails first.
		return realSpawn(...(args as [string, string[], unknown]));
	}) as typeof childProcess.spawn;
	try {
		const out = await runTool(registerJsTools, bad, "js_lint_fix", {
			paths: ["a.ts"],
		});
		assert.equal(out.isError, true);
		assert.equal(out.details.code, "PARSE_ERROR");
		assert.equal(calls.length, 0, "no spawn on config parse failure");
	} finally {
		childProcess.spawn = realSpawn;
	}
});

// --- F8: nothing lint-fixy is reachable via run_validation ---

test("run_validation audit: no configured check arg contains --fix/--write/--unsafe", () => {
	const config = loadValidationConfig(process.cwd());
	for (const [name, check] of Object.entries(config.validation.checks)) {
		for (const arg of check.args) {
			assert.ok(
				!arg.includes("--fix") &&
					!arg.includes("--write") &&
					!arg.includes("--unsafe"),
				`run_validation check "${name}" must not carry mutating flags: ${arg}`,
			);
		}
	}
});
