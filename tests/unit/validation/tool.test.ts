import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runValidation } from "../../../src/validation/execute.ts";
import {
	registerValidationTools,
	runValidationTool,
} from "../../../src/validation/index.ts";

const dirs: string[] = [];
function workspaceWithConfig(checks: unknown): string {
	const dir = mkdtempSync(path.join(tmpdir(), "pi-nobash-tool-"));
	dirs.push(dir);
	mkdirSync(path.join(dir, ".pi"), { recursive: true });
	writeFileSync(
		path.join(dir, ".pi", "pi-nobash.json"),
		JSON.stringify({ validation: { checks } }),
	);
	return dir;
}
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function envelope(result: {
	content: unknown;
	details: unknown;
	isError?: boolean;
}) {
	const content = result.content as Array<{ text?: string }>;
	return {
		isError: result.isError === true,
		text: content[0]?.text ?? "",
		details: result.details as { code?: string; message?: string },
	};
}

test("tool: unknown check is NOT_FOUND in the A5 envelope", async () => {
	const ws = workspaceWithConfig({});
	const out = envelope(await runValidation({ check: "nope" }, undefined, ws));
	assert.equal(out.isError, true);
	assert.ok(out.text.startsWith("NOT_FOUND: "));
	assert.equal(out.details.code, "NOT_FOUND");
});

test("tool: successful none-mode check returns structured result", async () => {
	const ws = workspaceWithConfig({
		echo: {
			program: "node",
			args: ["-e", "console.log('checks-ok')"],
			cwd: ".",
			timeoutMs: 30000,
			targets: { mode: "none" },
		},
	});
	const out = envelope(await runValidation({ check: "echo" }, undefined, ws));
	assert.equal(out.isError, false);
	assert.equal(out.details.code, undefined);
	const details = out.details as unknown as {
		exitCode: number;
		stdout: string;
	};
	assert.equal(details.exitCode, 0);
	assert.match(details.stdout, /checks-ok/);
	assert.match(out.text, /exit 0/);
});

test("tool: nonzero exit is VALIDATION_FAILED, timeout is TIMEOUT", async () => {
	const ws = workspaceWithConfig({
		fail: {
			program: "node",
			args: ["-e", "process.exit(3)"],
			cwd: ".",
			timeoutMs: 30000,
			targets: { mode: "none" },
		},
		slow: {
			program: "node",
			args: ["-e", "setTimeout(() => {}, 30000)"],
			cwd: ".",
			timeoutMs: 200,
			targets: { mode: "none" },
		},
	});
	const failed = envelope(
		await runValidation({ check: "fail" }, undefined, ws),
	);
	assert.equal(failed.isError, true);
	assert.equal(failed.details.code, "VALIDATION_FAILED");
	const timedOut = envelope(
		await runValidation({ check: "slow" }, undefined, ws),
	);
	assert.equal(timedOut.isError, true);
	assert.equal(timedOut.details.code, "TIMEOUT");
});

test("tool: schema audit — no generic-execution parameters (C8/AC7)", () => {
	const schema = runValidationTool.parameters as unknown as {
		properties: Record<string, unknown>;
	};
	const keys = collectKeys(schema);
	const forbidden = [
		"command",
		"argv",
		"script",
		"code",
		"program",
		"options",
		"shell",
		"env",
		"args",
	];
	for (const f of forbidden)
		assert.equal(keys.has(f), false, `forbidden parameter "${f}"`);
	assert.equal(runValidationTool.name, "run_validation");
	assert.equal(runValidationTool.exposure, "direct");
	assert.equal(runValidationTool.defaultActive, false);
});

function collectKeys(node: unknown, into = new Set<string>()): Set<string> {
	if (Array.isArray(node)) {
		for (const v of node) collectKeys(v, into);
	} else if (typeof node === "object" && node !== null) {
		for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
			into.add(k);
			collectKeys(v, into);
		}
	}
	return into;
}

test("tool: registerValidationTools registers run_validation via pi.registerTool", () => {
	const registered: string[] = [];
	const fakePi = {
		registerTool: (tool: { name: string }) => registered.push(tool.name),
	} as unknown as ExtensionAPI;
	registerValidationTools(fakePi);
	assert.deepEqual(registered, ["run_validation"]);
});

type Execute = (
	id: string,
	params: unknown,
	signal: undefined,
	onUpdate: undefined,
	ctx: { cwd: string },
) => Promise<{ content: unknown; details: unknown; isError?: boolean }>;

function captureRegistered(cwd: string): Execute {
	const tools: Array<{ name: string; execute: Execute }> = [];
	const pi = {
		registerTool: (tool: { name: string; execute: Execute }) =>
			tools.push(tool),
	} as unknown as ExtensionAPI;
	registerValidationTools(pi, cwd);
	const tool = tools.find((t) => t.name === "run_validation");
	assert.ok(tool, "run_validation must be registered");
	return tool.execute;
}

test("tool: snapshot is keyed to the session ctx.cwd, not the registration cwd", async () => {
	const noneMode = (exit: number) => ({
		program: process.execPath,
		args: ["-e", `process.exit(${exit})`],
		cwd: ".",
		timeoutMs: 10_000,
		targets: { mode: "none" as const },
	});
	const wsA = workspaceWithConfig({ ok: noneMode(0) });
	const wsB = workspaceWithConfig({ ok: noneMode(3) });

	// Registered against A, but the session context runs in B.
	const execute = captureRegistered(wsA);
	const inB = envelope(
		await execute("b1", { check: "ok" }, undefined, undefined, { cwd: wsB }),
	);
	assert.equal(inB.isError, true, "B's config must be used for a B session");
	assert.equal(inB.details.code, "VALIDATION_FAILED");

	// Editing B after its first use must not change the snapshot for B.
	writeFileSync(
		path.join(wsB, ".pi", "pi-nobash.json"),
		JSON.stringify({ validation: { checks: { ok: noneMode(0) } } }),
	);
	const inBAgain = envelope(
		await execute("b2", { check: "ok" }, undefined, undefined, { cwd: wsB }),
	);
	assert.equal(inBAgain.isError, true, "B's snapshot must persist");

	// A session in A still uses A's snapshot.
	const inA = envelope(
		await execute("a1", { check: "ok" }, undefined, undefined, { cwd: wsA }),
	);
	assert.equal(inA.isError, false);
});

test("tool: trusted config is snapshotted at registration, not re-read per invocation", async () => {
	const noneMode = (exit: number) => ({
		program: process.execPath,
		args: ["-e", `process.exit(${exit})`],
		cwd: ".",
		timeoutMs: 10_000,
		targets: { mode: "none" as const },
	});
	const ws = workspaceWithConfig({ ok: noneMode(0) });

	const execute = captureRegistered(ws);
	// Model-writable file changes after registration: same name, failing program.
	writeFileSync(
		path.join(ws, ".pi", "pi-nobash.json"),
		JSON.stringify({ validation: { checks: { ok: noneMode(3) } } }),
	);

	const snapshotted = envelope(
		await execute("t1", { check: "ok" }, undefined, undefined, { cwd: ws }),
	);
	assert.equal(
		snapshotted.isError,
		false,
		"snapshot must still run the registration-time program",
	);

	// A fresh registration under the same session picks up the rewritten file.
	const executeFresh = captureRegistered(ws);
	const reread = envelope(
		await executeFresh("t2", { check: "ok" }, undefined, undefined, {
			cwd: ws,
		}),
	);
	assert.equal(reread.isError, true);
	assert.equal(reread.details.code, "VALIDATION_FAILED");
});
