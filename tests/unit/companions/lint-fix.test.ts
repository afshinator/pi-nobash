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
import { JS_LINTERS } from "../../../companions/config.ts";
import { jsLintFix } from "../../../companions/javascript/lint-fix.ts";
import { jsLintFixTool } from "../../../companions/javascript/lint-fix.ts";

const dirs: string[] = [];
function workspace(): string {
	const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "pi-nobash-lint-")));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
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

test("enumerated linter -> exact argv (biome / eslint / ruff)", async () => {
	const ws = workspace();
	writeFileSync(path.join(ws, "a.ts"), "export let x = 1;\n");
	installSpawnInterceptor();
	try {
		for (const [linter, program, args] of [
			["biome", "npx", ["biome", "check", "--write", "--"]],
			["eslint", "npx", ["eslint", "--fix", "--"]],
		] as const) {
			calls.length = 0;
			scripted = fakeChild(0, "", "");
			const out = envelope(
				await jsLintFix({ paths: ["a.ts"] }, undefined, ws, linter),
			);
			assert.equal(out.isError, false, out.text);
			assert.equal(calls.length, 1, `${linter}: exactly one spawn`);
			const call = calls[0];
			assert.ok(call);
			assert.equal(call.program, program);
			assert.deepEqual(call.args, [...args, path.join(ws, "a.ts")]);
			assert.deepEqual(out.details, {
				fixed: ["a.ts"],
				remainingIssues: false,
				truncated: false,
			});
		}
	} finally {
		restoreSpawn();
	}
});

test("51 paths -> LIMIT_EXCEEDED with zero spawns", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	calls.length = 0;
	try {
		const paths = Array.from({ length: 51 }, (_, i) => `f${i}.ts`);
		const js = envelope(
			await jsLintFix({ paths }, undefined, ws, "biome"),
		);
		assert.equal(js.isError, true);
		assert.equal(js.details.code, "LIMIT_EXCEEDED");
		assert.equal(calls.length, 0, "no spawn before the limit check");
	} finally {
		restoreSpawn();
	}
});

test("scope rejections: .., absolute, symlink escape, node_modules, option-like, extension, missing — zero spawns", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	calls.length = 0;
	try {
		const outside = workspace();
		writeFileSync(path.join(outside, "secret.ts"), "x\n");
		symlinkSync(path.join(outside, "secret.ts"), path.join(ws, "link.ts"));
		writeFileSync(path.join(ws, "in.ts"), "x\n");
		writeFileSync(path.join(ws, "in.css"), "a{}\n");
		mkdirSync(path.join(ws, "node_modules"));
		writeFileSync(path.join(ws, "node_modules", "pkg.ts"), "x\n");
		symlinkSync(path.join(ws, "node_modules"), path.join(ws, "nm"));
		const jsCases: Array<[string, string, "biome" | "eslint", string]> = [
			["..", "../escape.ts", "biome", "ANY"],
			["absolute", path.join(outside, "secret.ts"), "biome", "ANY"],
			["symlink escape", "link.ts", "biome", "ANY"],
			["node_modules", "node_modules/pkg.ts", "biome", "ANY"],
			["node_modules case variant", "NODE_MODULES/pkg.ts", "biome", "ANY"],
			["node_modules symlink alias", "nm/pkg.ts", "biome", "ANY"],
			["option-like", "-o.ts", "biome", "ANY"],
			["bad extension (biome)", "in.rs", "biome", "INVALID_ARGUMENT"],
			["bad extension (eslint css)", "in.css", "eslint", "INVALID_ARGUMENT"],
			["missing", "nope.ts", "biome", "ANY"],
		];
		for (const [label, p, linter, forced] of jsCases) {
			const out = envelope(
				await jsLintFix({ paths: [p] }, undefined, ws, linter),
			);
			assert.equal(out.isError, true, `expected rejection for ${label}`);
			if (forced !== "ANY")
				assert.equal(out.details.code, forced, label);
			else
				assert.ok(
					["INVALID_ARGUMENT", "PATH_OUT_OF_SCOPE", "NOT_FOUND"].includes(
						out.details.code as string,
					),
					`unexpected code ${out.details.code} for ${label}`,
				);
		}
		assert.equal(
			calls.length,
			0,
			"no process may be spawned for rejected paths",
		);
	} finally {
		restoreSpawn();
	}
});

test("linter exit 1 is a SUCCESS envelope with remainingIssues true; exit 0 -> false", async () => {
	const ws = workspace();
	writeFileSync(path.join(ws, "a.ts"), "export let x = 1;\n");
	writeFileSync(path.join(ws, "u.ts"), "export const a = 1;\nexport const c = a == 1;\n");
	installSpawnInterceptor();
	try {
		scripted = fakeChild(1, "", "diagnostics remain");
		const out = envelope(
			await jsLintFix({ paths: ["u.ts"] }, undefined, ws, "biome"),
		);
		assert.equal(out.isError, false, "exit 1 must not be an error (F4)");
		assert.deepEqual(out.details, {
			fixed: ["u.ts"],
			remainingIssues: true,
			truncated: false,
		});
		scripted = fakeChild(0, "", "");
		const clean = envelope(
			await jsLintFix({ paths: ["a.ts"] }, undefined, ws, "biome"),
		);
		assert.equal(clean.isError, false);
		assert.equal(clean.details.remainingIssues, false);

	} finally {
		restoreSpawn();
	}
});

test("timeout -> TIMEOUT", async () => {
	const ws = workspace();
	writeFileSync(path.join(ws, "a.ts"), "export let x = 1;\n");
	installSpawnInterceptor();
	try {
		scripted = slowChild();
		const out = envelope(
			await jsLintFix({ paths: ["a.ts"] }, undefined, ws, "biome", 80),
		);
		assert.equal(out.isError, true);
		assert.equal(out.details.code, "TIMEOUT");
	} finally {
		restoreSpawn();
	}
});

test("schema audit — no backend/command/flag field in either lint-fix schema", () => {
	for (const tool of [jsLintFixTool]) {
		const keys = collectKeys(tool.parameters);
		for (const forbidden of [
			"backend",
			"mode",
			"flags",
			"unsafe",
			"unsafeFixes",
			"fix",
			"command",
			"argv",
			"program",
			"executable",
			"config",
			"shell",
			"options",
			"script",
		]) {
			assert.ok(
				!keys.includes(forbidden),
				`${tool.name}: schema exposes "${forbidden}"`,
			);
		}
		assert.equal(tool.name, "js_lint_fix");
		// details shape: exactly fixed/remainingIssues/truncated.
		const detailKeys = collectKeys(tool.outputSchema);
		for (const expected of ["fixed", "remainingIssues", "truncated"])
			assert.ok(detailKeys.includes(expected), `${tool.name}.outputSchema.${expected}`);
	}
});

test("no --unsafe token in any linter argv (F4: safe fixes only)", () => {
	for (const [name, inv] of Object.entries(JS_LINTERS)) {
		for (const arg of inv.args)
			assert.ok(!arg.includes("unsafe"), `${name}: unsafe token in argv: ${arg}`);
	}
});
