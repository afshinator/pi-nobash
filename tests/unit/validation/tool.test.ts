import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
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
		on: () => () => {},
	} as unknown as ExtensionAPI;
	registerValidationTools(fakePi);
	assert.deepEqual(registered, ["run_validation"]);
});

type Execute = (
	id: string,
	params: unknown,
	signal: undefined,
	onUpdate: undefined,
	ctx: { cwd: string; sessionManager: { getSessionId: () => string } },
) => Promise<{ content: unknown; details: unknown; isError?: boolean }>;

function toolCtx(
	cwd: string,
	id = "unit",
): { cwd: string; sessionManager: { getSessionId: () => string } } {
	return { cwd, sessionManager: { getSessionId: () => id } };
}

function captureRegistered(cwd: string): {
	execute: Execute;
	fireSessionStart: (cwd: string, id?: string) => void;
} {
	const tools: Array<{ name: string; execute: Execute }> = [];
	const sessionStartHandlers: Array<
		(event: undefined, ctx: { cwd: string }) => void
	> = [];
	const pi = {
		registerTool: (tool: { name: string; execute: Execute }) =>
			tools.push(tool),
		on: (
			event: string,
			handler: (event: undefined, ctx: { cwd: string }) => void,
		) => {
			if (event === "session_start") sessionStartHandlers.push(handler);
			return () => {};
		},
	} as unknown as ExtensionAPI;
	registerValidationTools(pi, cwd);
	const tool = tools.find((t) => t.name === "run_validation");
	assert.ok(tool, "run_validation must be registered");
	return {
		execute: tool.execute,
		fireSessionStart: (sessionCwd: string, id = "unit") => {
			for (const h of sessionStartHandlers)
				h(undefined, toolCtx(sessionCwd, id));
		},
	};
}

// Supersedes run-1 F7 ("snapshot is keyed to the session ctx.cwd"): A10/C9
// normatively rejects a ctx.cwd that differs from the activation cwd instead of
// lazily loading that directory's config. This is a narrowed contract, not a
// weakened test; the lazy per-cwd load it asserted is the composition route A10
// closes.
test("tool: ctx.cwd other than the activation cwd is INVALID_ARGUMENT (C9/A10)", async () => {
	const noneMode = (exit: number) => ({
		program: process.execPath,
		args: ["-e", `process.exit(${exit})`],
		cwd: ".",
		timeoutMs: 10_000,
		targets: { mode: "none" as const },
	});
	const wsA = workspaceWithConfig({ ok: noneMode(0) });
	const wsB = workspaceWithConfig({ ok: noneMode(3) });

	// Registered against A, but the session context runs in B: no B config was
	// loaded at activation, so the call is rejected without reading B's file.
	const { execute } = captureRegistered(wsA);
	const inB = envelope(
		await execute("b1", { check: "ok" }, undefined, undefined, toolCtx(wsB)),
	);
	assert.equal(inB.isError, true, "a foreign cwd must be rejected");
	assert.equal(inB.details.code, "INVALID_ARGUMENT");
	assert.equal(
		inB.details.message,
		"no validation config loaded for this workspace",
	);

	// Repeated calls stay rejected; B's config is never read.
	const inBAgain = envelope(
		await execute("b2", { check: "ok" }, undefined, undefined, toolCtx(wsB)),
	);
	assert.equal(inBAgain.details.code, "INVALID_ARGUMENT");

	// A session in the activation cwd still runs A's snapshot.
	const inA = envelope(
		await execute("a1", { check: "ok" }, undefined, undefined, toolCtx(wsA)),
	);
	assert.equal(inA.isError, false);
});

test("tool: session_start binds the config to the session cwd (C9)", async () => {
	const noneMode = (exit: number) => ({
		program: process.execPath,
		args: ["-e", `process.exit(${exit})`],
		cwd: ".",
		timeoutMs: 10_000,
		targets: { mode: "none" as const },
	});
	const wsA = workspaceWithConfig({ ok: noneMode(0) });
	const wsB = workspaceWithConfig({ ok: noneMode(3) });

	// Registration cwd is A, but the real session starts in B (e.g. SDK or
	// CLI session cwd differs from the process cwd): the session cwd governs.
	const { execute, fireSessionStart } = captureRegistered(wsA);
	fireSessionStart(wsB);

	const inB = envelope(
		await execute("m1", { check: "ok" }, undefined, undefined, toolCtx(wsB)),
	);
	assert.equal(
		inB.details.code,
		"VALIDATION_FAILED",
		"session cwd B must run B's configured check",
	);

	// A is now foreign to the session.
	const inA = envelope(
		await execute("m2", { check: "ok" }, undefined, undefined, toolCtx(wsA)),
	);
	assert.equal(inA.details.code, "INVALID_ARGUMENT");

	// A rewrite of B's config after session_start cannot change the running check.
	writeFileSync(
		path.join(wsB, ".pi", "pi-nobash.json"),
		JSON.stringify({ validation: { checks: { ok: noneMode(0) } } }),
	);
	const inBAfterEdit = envelope(
		await execute("m3", { check: "ok" }, undefined, undefined, toolCtx(wsB)),
	);
	assert.equal(
		inBAfterEdit.details.code,
		"VALIDATION_FAILED",
		"post-session_start rewrite must not change the invoked check",
	);
});

test("tool: same directory via different path forms is accepted; a different directory is still INVALID_ARGUMENT (C9 hardening)", async () => {
	const noneMode = (exit: number) => ({
		program: process.execPath,
		args: ["-e", `process.exit(${exit})`],
		cwd: ".",
		timeoutMs: 10_000,
		targets: { mode: "none" as const },
	});
	const ws = workspaceWithConfig({ ok: noneMode(0) });
	// Same directory under another path form: a symlink next to it.
	const link = path.join(path.dirname(ws), `${path.basename(ws)}-link`);
	try {
		symlinkSync(ws, link, "dir");
	} catch {
		// Some filesystems disallow symlinks; use the macOS /var vs /private/var
		// realpath divergence instead, which the strict compare also rejects.
	}
	const otherForm = fsExists(link) ? link : realpathSync(ws);
	dirs.push(link);

	// Registered with one path form, executed with the other: the SAME directory
	// must run its configured check, not be rejected.
	const { execute } = captureRegistered(ws);
	const viaOtherForm = envelope(
		await execute(
			"s1",
			{ check: "ok" },
			undefined,
			undefined,
			toolCtx(otherForm),
		),
	);
	assert.equal(
		viaOtherForm.isError,
		false,
		`same directory via ${otherForm} must not be INVALID_ARGUMENT`,
	);

	// Control: a genuinely different directory is still rejected.
	const wsOther = workspaceWithConfig({});
	const foreign = envelope(
		await execute(
			"s2",
			{ check: "ok" },
			undefined,
			undefined,
			toolCtx(wsOther),
		),
	);
	assert.equal(foreign.details.code, "INVALID_ARGUMENT");
});

test("tool: two sessions from one registration each run their own snapshot (C9 multi-session)", async () => {
	const noneMode = (exit: number) => ({
		program: process.execPath,
		args: ["-e", `process.exit(${exit})`],
		cwd: ".",
		timeoutMs: 10_000,
		targets: { mode: "none" as const },
	});
	const wsA = workspaceWithConfig({ ok: noneMode(0) });
	const wsB = workspaceWithConfig({ ok: noneMode(3) });

	// One registration, two SDK sessions bound to different cwds.
	const { execute, fireSessionStart } = captureRegistered(wsA);
	fireSessionStart(wsA, "S1");
	fireSessionStart(wsB, "S2");

	const s1 = envelope(
		await execute(
			"p1",
			{ check: "ok" },
			undefined,
			undefined,
			toolCtx(wsA, "S1"),
		),
	);
	assert.equal(s1.isError, false, "S1 must run A's check (exit 0)");

	const s2 = envelope(
		await execute(
			"p2",
			{ check: "ok" },
			undefined,
			undefined,
			toolCtx(wsB, "S2"),
		),
	);
	assert.equal(
		s2.details.code,
		"VALIDATION_FAILED",
		"S2 must run B's check (exit 3)",
	);

	// S2's bind must not clobber S1's.
	const s1Again = envelope(
		await execute(
			"p3",
			{ check: "ok" },
			undefined,
			undefined,
			toolCtx(wsA, "S1"),
		),
	);
	assert.equal(
		s1Again.isError,
		false,
		"S1 must still work after S2's session_start",
	);
});

function fsExists(p: string): boolean {
	try {
		realpathSync(p);
		return true;
	} catch {
		return false;
	}
}

test("tool: config is read once at activation; a post-activation rewrite does not change the running checks (C9/A10)", async () => {
	const noneMode = (exit: number) => ({
		program: process.execPath,
		args: ["-e", `process.exit(${exit})`],
		cwd: ".",
		timeoutMs: 10_000,
		targets: { mode: "none" as const },
	});
	const ws = workspaceWithConfig({ ok: noneMode(0) });

	const { execute } = captureRegistered(ws);
	// Model-writable file changes after registration: same name, failing program.
	writeFileSync(
		path.join(ws, ".pi", "pi-nobash.json"),
		JSON.stringify({ validation: { checks: { ok: noneMode(3) } } }),
	);

	const snapshotted = envelope(
		await execute("t1", { check: "ok" }, undefined, undefined, toolCtx(ws)),
	);
	assert.equal(
		snapshotted.isError,
		false,
		"snapshot must still run the registration-time program",
	);

	// A fresh registration under the same session picks up the rewritten file.
	const executeFresh = captureRegistered(ws).execute;
	const reread = envelope(
		await executeFresh(
			"t2",
			{ check: "ok" },
			undefined,
			undefined,
			toolCtx(ws),
		),
	);
	assert.equal(reread.isError, true);
	assert.equal(reread.details.code, "VALIDATION_FAILED");
});
