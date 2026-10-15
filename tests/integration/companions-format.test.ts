/**
 * Real-formatter integration for js_format_write (P0-5) and py_format_write
 * (P0-6): exact pre/post byte diffs in disposable temp workspaces.
 *
 * - Biome runs from the repo's devDependency (`npx biome`, offline).
 * - Prettier resolves offline via `npx --no-install prettier` (verified 3.9.10).
 * - Ruff: two branches. When a real `ruff` is on PATH, py_format_write is
 *   byte-diffed against the REAL Ruff output. When Ruff is absent (this
 *   machine: no uv/pipx), the real branch SKIPS with a printed reason, and a
 *   clearly-labelled STUB test (deterministic `ruff` shim on PATH) keeps the
 *   argv/post-bytes plumbing covered. The stub never counts as a real-Ruff
 *   pass.
 *   shortcut: stubbed Ruff; upgrade to a real-ruff byte-diff test when Ruff is
 *   available in the test environment.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
function writeCompanionConfig(ws: string, formatter: string): void {
	mkdirSync(path.join(ws, ".pi"), { recursive: true });
	writeFileSync(
		path.join(ws, ".pi", "pi-nobash-companions.json"),
		JSON.stringify({
			companions: {
				javascript: {
					formatter,
					linter: "biome",
					packageManager: "npm",
				},
				python: { formatter: "ruff", linter: "ruff", packageManager: "uv" },
			},
		}),
	);
}

/** Binds a session for `ws`, runs the single registered tool, asserts success. */
async function runTool(
	register: (pi: ExtensionAPI) => void,
	ws: string,
	params: { paths: string[] },
): Promise<{ formatted: string[]; truncated: boolean }> {
	const { pi, fire, registered } = mockRegistrar();
	register(pi);
	const sessionId = `it-${++sessionSeq}`; // stable for the life of this ctx
	const ctx = {
		cwd: ws,
		sessionManager: { getSessionId: () => sessionId },
	};
	fire("session_start", ctx);
	assert.equal(registered.length, 1);
	const tool = registered[0];
	assert.ok(tool);
	const result = await tool.execute("id", params, undefined, undefined, ctx);
	assert.notEqual(result.isError, true, result.content[0]?.text);
	return result.details as { formatted: string[]; truncated: boolean };
}

const UNFORMATTED = "const   x=1\nfunction  f ( a ,b ) { return a+b }\n";

/** Resolves a real `ruff` from PATH, or null (with reason) when absent. */
function findRealRuff(): string | null {
	try {
		const p = execFileSync("which", ["ruff"], { stdio: "pipe" })
			.toString()
			.trim();
		return p.length > 0 ? p : null;
	} catch {
		return null;
	}
}

test("py_format_write (REAL ruff from PATH): exact post bytes, others untouched", {
	timeout: 120_000,
}, async (t) => {
	const ruff = findRealRuff();
	if (!ruff)
		return t.skip(
			"ruff not on PATH — real-Ruff byte-diff branch cannot run here (no ruff/uv installed)",
		);

	const ws = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-fmt-it-")),
	);
	dirs.push(ws);
	writeCompanionConfig(ws, "ruff");
	writeFileSync(path.join(ws, "a.py"), "x  =1\n");
	const untouched = "y = 2\n";
	writeFileSync(path.join(ws, "b.py"), untouched);

	// Reference: what the real ruff produces for this fixture, run directly.
	execFileSync(ruff, ["format", "--", path.join(ws, "a.py")], {
		stdio: "pipe",
	});
	const expected = readFileSync(path.join(ws, "a.py"));

	// Reset the fixture and run the SAME input through the tool instead.
	writeFileSync(path.join(ws, "a.py"), "x  =1\n");
	const details = await runTool(registerPythonTools, ws, { paths: ["a.py"] });
	assert.deepEqual(details, { formatted: ["a.py"], truncated: false });

	// Tool output must be byte-identical to real-ruff output.
	assert.ok(
		expected.equals(readFileSync(path.join(ws, "a.py"))),
		"post-bytes must equal real ruff format output",
	);
	assert.equal(readFileSync(path.join(ws, "b.py"), "utf8"), untouched);
});

test("js_format_write (biome): exact post bytes, others untouched, idempotent", {
	timeout: 120_000,
}, async () => {
	const ws = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-fmt-it-")),
	);
	dirs.push(ws);
	writeCompanionConfig(ws, "biome");
	writeFileSync(path.join(ws, "messy.ts"), UNFORMATTED);
	const untouched = "const keep = 1;\n";
	writeFileSync(path.join(ws, "tidy.ts"), untouched);

	const details = await runTool(registerJsTools, ws, { paths: ["messy.ts"] });
	assert.deepEqual(details, { formatted: ["messy.ts"], truncated: false });

	// Exact post bytes (deterministic Biome output: tab indent).
	const expected = "const x = 1;\nfunction f(a, b) {\n\treturn a + b;\n}\n";
	assert.equal(readFileSync(path.join(ws, "messy.ts"), "utf8"), expected);
	assert.equal(readFileSync(path.join(ws, "tidy.ts"), "utf8"), untouched);

	// Idempotency: formatting again yields identical bytes.
	await runTool(registerJsTools, ws, { paths: ["messy.ts"] });
	assert.equal(readFileSync(path.join(ws, "messy.ts"), "utf8"), expected);
});

test("js_format_write (prettier): exact post bytes, others untouched", {
	timeout: 120_000,
}, async () => {
	const ws = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-fmt-it-")),
	);
	dirs.push(ws);
	writeCompanionConfig(ws, "prettier");
	writeFileSync(path.join(ws, "messy.ts"), UNFORMATTED);
	const untouched = "const keep = 1;\n";
	writeFileSync(path.join(ws, "tidy.ts"), untouched);

	const details = await runTool(registerJsTools, ws, { paths: ["messy.ts"] });
	assert.deepEqual(details, { formatted: ["messy.ts"], truncated: false });

	// Exact post bytes (deterministic Prettier output: 2-space indent).
	const expected = "const x = 1;\nfunction f(a, b) {\n  return a + b;\n}\n";
	assert.equal(readFileSync(path.join(ws, "messy.ts"), "utf8"), expected);
	assert.equal(readFileSync(path.join(ws, "tidy.ts"), "utf8"), untouched);
});

test("py_format_write (STUB ruff, not real Ruff): exact argv and post bytes, others untouched", {
	timeout: 60_000,
}, async () => {
	const ws = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-fmt-it-")),
	);
	dirs.push(ws);
	const bin = mkdtempSync(path.join(tmpdir(), "pi-nobash-ruff-bin-"));
	dirs.push(bin);
	const marker = path.join(bin, "argv-marker.txt");
	// Deterministic ruff stub: record argv, rewrite the named file ($3 after
	// `format -- $path`) to known bytes.
	const stub = [
		"#!/bin/sh",
		`printf '%s\\n' "$*" >> "${marker}"`,
		"printf 'x = 1\\n' > \"$3\"",
		"exit 0",
		"",
	].join("\n");
	const stubPath = path.join(bin, "ruff");
	writeFileSync(stubPath, stub);
	chmodSync(stubPath, 0o755);
	const realPathEnv = process.env.PATH;
	process.env.PATH = `${bin}:${realPathEnv}`;
	try {
		writeFileSync(path.join(ws, "a.py"), "x  =1\n");
		const untouched = "y = 2\n";
		writeFileSync(path.join(ws, "b.py"), untouched);

		const details = await runTool(registerPythonTools, ws, { paths: ["a.py"] });
		assert.deepEqual(details, { formatted: ["a.py"], truncated: false });

		// The stub was invoked with exactly the frozen argv.
		assert.equal(
			readFileSync(marker, "utf8"),
			`format -- ${path.join(ws, "a.py")}\n`,
		);
		// Exact post bytes written by the stub; the other file is untouched.
		assert.equal(readFileSync(path.join(ws, "a.py"), "utf8"), "x = 1\n");
		assert.equal(readFileSync(path.join(ws, "b.py"), "utf8"), untouched);
	} finally {
		process.env.PATH = realPathEnv;
	}
});
