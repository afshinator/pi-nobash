import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
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
import { jsFormatWrite } from "../../../companions/javascript/format-write.ts";
import { registerJsTools } from "../../../companions/javascript/index.ts";
import { pyFormatWrite } from "../../../companions/python/format-write.ts";
import { registerPythonTools } from "../../../companions/python/index.ts";

const dirs: string[] = [];
function workspace(): string {
	const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "pi-nobash-fmt-")));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// --- tool-level harness: mock pi + session_start firing (F2a) ---
let sessionSeq = 0;
function mockRegistrar(): {
	pi: ExtensionAPI;
	fire(event: string, ctx: unknown): void;
	registered: Array<{
		name: string;
		execute: (...args: unknown[]) => unknown;
	}>;
} {
	const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
	const registered: Array<{
		name: string;
		execute: (...args: unknown[]) => unknown;
	}> = [];
	const pi = {
		on(event: string, handler: (...args: unknown[]) => unknown) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
		registerTool(tool: {
			name: string;
			execute: (...args: unknown[]) => unknown;
		}) {
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
function toolCtx(cwd: string): ToolCtxView {
	const id = `fmt-${++sessionSeq}`; // stable for the life of this ctx
	return { cwd, sessionManager: { getSessionId: () => id } };
}
type ToolCtxView = {
	cwd: string;
	sessionManager: { getSessionId(): string };
};
function writeCompanionConfig(ws: string, content: unknown): void {
	mkdirSync(path.join(ws, ".pi"), { recursive: true });
	writeFileSync(
		path.join(ws, ".pi", "pi-nobash-companions.json"),
		typeof content === "string" ? content : JSON.stringify(content),
	);
}

/** Runs py_format_write's execute with the same session id as the bound session. */
async function runPyTool(ws: string, execCwd: string = ws) {
	const session = toolCtx(ws);
	const execCtx = { ...session, cwd: execCwd };
	const { pi, fire, registered } = mockRegistrar();
	registerPythonTools(pi);
	fire("session_start", session);
	const tool = registered[0];
	assert.ok(tool);
	// No try/catch: the registered execute must RETURN the C3 envelope for config
	// errors. A throw would be converted by Pi to `details: {}`.
	return (await tool.execute(
		"id",
		{ paths: ["a.py"] },
		undefined,
		undefined,
		execCtx,
	)) as {
		isError?: boolean;
		content: Array<{ text?: string }>;
		details: Record<string, unknown>;
	};
}

test("py_format_write: foreign ctx.cwd -> INVALID_ARGUMENT (F2a)", async () => {
	const ws = workspace();
	const other = workspace();
	writeCompanionConfig(ws, {}); // defaults; session bound to ws
	writeFileSync(path.join(ws, "a.py"), "x = 1\n");
	installSpawnInterceptor();
	calls.length = 0;
	try {
		const result = await runPyTool(ws, other);
		assert.equal(result.isError, true);
		assert.equal(result.details.code, "INVALID_ARGUMENT");
		assert.equal(calls.length, 0, "no spawn for a foreign workspace");
	} finally {
		restoreSpawn();
	}
});

test("py_format_write: malformed config -> PARSE_ERROR (F2a)", async () => {
	const ws = workspace();
	writeCompanionConfig(ws, "{ companions: {");
	writeFileSync(path.join(ws, "a.py"), "x = 1\n");
	installSpawnInterceptor();
	calls.length = 0;
	try {
		const result = await runPyTool(ws, ws);
		assert.equal(result.isError, true);
		assert.equal(result.details.code, "PARSE_ERROR");
		assert.equal(calls.length, 0, "no spawn on config parse failure");
	} finally {
		restoreSpawn();
	}
});

// --- spawn interception (same trick companions/process.ts documents) ---
type SpawnCall = { program: string; args: string[]; opts: unknown };
const realSpawn = childProcess.spawn;
const calls: SpawnCall[] = [];
let scripted: ((call: SpawnCall) => unknown) | null = null;

function installSpawnInterceptor(): void {
	childProcess.spawn = ((program: string, args: string[], opts: unknown) => {
		const call = { program, args, opts };
		calls.push(call);
		const scripted_ = scripted;
		scripted = null;
		if (scripted_) return scripted_(call) as never;
		return realSpawn(program, args, opts as never);
	}) as typeof childProcess.spawn;
}
function restoreSpawn(): void {
	childProcess.spawn = realSpawn;
}

type FakeChild = EventEmitter & {
	stdout: EventEmitter;
	stderr: EventEmitter;
	kill(): void;
};

function makeChild(): FakeChild {
	const child = new EventEmitter() as FakeChild;
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.kill = () => {};
	return child;
}

/** Fake child: emits the given stdout/stderr and exits with `code`; honors abort signals. */
function fakeChild(code: number, stdout: string, stderr: string) {
	return (call: SpawnCall) => {
		const child = makeChild();
		const opts = call.opts as { signal?: AbortSignal };
		queueMicrotask(() => {
			if (opts.signal?.aborted) return;
			if (stdout) child.stdout.emit("data", Buffer.from(stdout));
			if (stderr) child.stderr.emit("data", Buffer.from(stderr));
			child.emit("close", code);
		});
		opts.signal?.addEventListener("abort", () => {
			child.emit("error", new Error("AbortError"));
			child.emit("close", null);
		});
		return child as never;
	};
}

function slowChild() {
	return (call: SpawnCall) => {
		const child = makeChild();
		const opts = call.opts as { signal?: AbortSignal };
		opts.signal?.addEventListener("abort", () => {
			child.emit("error", new Error("AbortError"));
			child.emit("close", null);
		});
		return child as never;
	};
}

function envelope(result: {
	content: unknown;
	details: unknown;
	isError?: boolean | undefined;
}) {
	const content = result.content as Array<{ text?: string }>;
	return {
		isError: result.isError === true,
		text: content[0]?.text ?? "",
		details: result.details as Record<string, unknown>,
	};
}

function collectKeys(node: unknown, out: string[] = []): string[] {
	if (Array.isArray(node)) {
		for (const item of node) collectKeys(item, out);
	} else if (node && typeof node === "object") {
		for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
			out.push(k);
			collectKeys(v, out);
		}
	}
	return out;
}

const jsTool = (() => {
	const tools: unknown[] = [];
	const pi = {
		registerTool: (t: unknown) => tools.push(t),
		on: () => () => {},
	} as unknown as ExtensionAPI;
	registerJsTools(pi);
	return tools[0] as { parameters: unknown; name: string };
})();
const pyTool = (() => {
	const tools: unknown[] = [];
	const pi = {
		registerTool: (t: unknown) => tools.push(t),
		on: () => () => {},
	} as unknown as ExtensionAPI;
	registerPythonTools(pi);
	return tools[0] as { parameters: unknown; name: string };
})();

test("schema audit — no backend/command/flag field in either schema", () => {
	for (const tool of [jsTool, pyTool]) {
		const keys = collectKeys(tool.parameters);
		for (const forbidden of [
			"backend",
			"command",
			"argv",
			"script",
			"program",
			"executable",
			"flags",
			"options",
			"config",
			"shell",
		]) {
			assert.ok(
				!keys.includes(forbidden),
				`${tool.name}: schema exposes "${forbidden}"`,
			);
		}
	}
	assert.equal(jsTool.name, "js_format_write");
	assert.equal(pyTool.name, "py_format_write");
});

test("enumerated backend -> exact argv (prettier / biome / ruff)", async () => {
	const ws = workspace();
	writeFileSync(path.join(ws, "a.ts"), "const x = 1;\n");
	installSpawnInterceptor();
	try {
		for (const [formatter, program, args] of [
			["prettier", "npx", ["prettier", "--write", "--"]],
			["biome", "npx", ["biome", "format", "--write", "--"]],
		] as const) {
			calls.length = 0;
			scripted = fakeChild(0, "", "");
			const out = envelope(
				await jsFormatWrite({ paths: ["a.ts"] }, undefined, ws, formatter),
			);
			assert.equal(out.isError, false, out.text);
			assert.equal(calls.length, 1);
			const call = calls[0];
			assert.ok(call);
			assert.equal(call.program, program);
			assert.deepEqual(call.args, [...args, path.join(ws, "a.ts")]);
		}
		calls.length = 0;
		scripted = fakeChild(0, "", "");
		writeFileSync(path.join(ws, "m.py"), "x = 1\n");
		const out = envelope(
			await pyFormatWrite({ paths: ["m.py"] }, undefined, ws, undefined),
		);
		assert.equal(out.isError, false, out.text);
		assert.equal(calls[0]?.program, "ruff");
		assert.deepEqual(calls[0]?.args, ["format", "--", path.join(ws, "m.py")]);
	} finally {
		restoreSpawn();
	}
});

test("51 paths -> LIMIT_EXCEEDED", async () => {
	const ws = workspace();
	const paths = Array.from({ length: 51 }, (_, i) => `f${i}.ts`);
	const js = envelope(
		await jsFormatWrite({ paths }, undefined, ws, "prettier"),
	);
	assert.equal(js.isError, true);
	assert.equal(js.details.code, "LIMIT_EXCEEDED");
	const py = envelope(
		await pyFormatWrite(
			{ paths: paths.map((p) => `${p.slice(0, -3)}.py`) },
			undefined,
			ws,
			undefined,
		),
	);
	assert.equal(py.isError, true);
	assert.equal(py.details.code, "LIMIT_EXCEEDED");
});

test("scope rejections: .., absolute, symlink escape, node_modules, option-like", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	calls.length = 0;
	try {
		const outside = workspace();
		writeFileSync(path.join(outside, "secret.ts"), "x\n");
		symlinkSync(path.join(outside, "secret.ts"), path.join(ws, "link.ts"));
		writeFileSync(path.join(ws, "in.ts"), "x\n");
		mkdirSync(path.join(ws, "node_modules"));
		writeFileSync(path.join(ws, "node_modules", "pkg.ts"), "x\n");
		symlinkSync(path.join(ws, "node_modules"), path.join(ws, "nm"));
		const cases: Array<[string, string]> = [
			["..", "../escape.ts"],
			["absolute", path.join(outside, "secret.ts")],
			["symlink escape", "link.ts"],
			["node_modules", "node_modules/pkg.ts"],
			["node_modules case variant", "NODE_MODULES/pkg.ts"],
			["node_modules symlink alias", "nm/pkg.ts"],
			["option-like", "-o.ts"],
			["bad extension", "in.rs"],
			["missing", "nope.ts"],
		];
		for (const [label, p] of cases) {
			const out = envelope(
				await jsFormatWrite({ paths: [p] }, undefined, ws, "prettier"),
			);
			assert.equal(out.isError, true, `expected rejection for ${label}`);
			assert.ok(
				["INVALID_ARGUMENT", "PATH_OUT_OF_SCOPE", "NOT_FOUND"].includes(
					out.details.code as string,
				),
				`unexpected code ${out.details.code} for ${label}`,
			);
		}
		// Python: wrong extension and scope rejections too.
		writeFileSync(path.join(ws, "ok.py"), "x = 1\n");
		const py = envelope(
			await pyFormatWrite({ paths: ["ok.ts"] }, undefined, ws, undefined),
		);
		assert.equal(py.isError, true);
		assert.equal(py.details.code, "INVALID_ARGUMENT");
		assert.equal(
			calls.length,
			0,
			"no process may be spawned for rejected paths",
		);
	} finally {
		restoreSpawn();
	}
});

test("non-zero exit -> VALIDATION_FAILED; timeout -> TIMEOUT", async () => {
	const ws = workspace();
	writeFileSync(path.join(ws, "a.ts"), "const x = 1;\n");
	installSpawnInterceptor();
	try {
		scripted = fakeChild(3, "", "boom: syntax error");
		const failed = envelope(
			await jsFormatWrite({ paths: ["a.ts"] }, undefined, ws, "prettier"),
		);
		assert.equal(failed.isError, true);
		assert.equal(failed.details.code, "VALIDATION_FAILED");

		writeFileSync(path.join(ws, "t.py"), "x = 1\n");
		scripted = slowChild();
		const timedOut = envelope(
			await pyFormatWrite({ paths: ["t.py"] }, undefined, ws, undefined, 80),
		);
		assert.equal(timedOut.isError, true);
		assert.equal(timedOut.details.code, "TIMEOUT");
	} finally {
		restoreSpawn();
	}
});
