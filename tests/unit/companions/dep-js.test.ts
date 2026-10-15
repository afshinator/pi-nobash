import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	bindCompanionConfig,
	type DepCommands,
	JS_PACKAGE_MANAGERS,
} from "../../../companions/config.ts";
import {
	jsDepAdd,
	jsDepAddTool,
	jsDepRemove,
	jsDepRemoveTool,
	MAX_DEP_PACKAGES,
} from "../../../companions/javascript/dep.ts";
import { registerJsTools } from "../../../companions/javascript/index.ts";

const dirs: string[] = [];
function workspace(): string {
	const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "pi-nobash-dep-")));
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
function fakeChild(code: number, stdout = "", stderr = "") {
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

// --- exact argv (F2): frozen table args, names appended last, no `--` ---
test("js_dep_add dev absent: exact argv npm install --ignore-scripts <name>", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		calls.length = 0;
		scripted = fakeChild(0);
		const out = envelope(
			await jsDepAdd({ packages: ["left-pad"] }, undefined, ws),
		);
		assert.equal(out.isError, false, out.text);
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.program, "npm");
		assert.deepEqual(calls[0]?.args, [
			"install",
			"--ignore-scripts",
			"left-pad",
		]);
		assert.deepEqual(out.details, {
			packages: ["left-pad"],
			dev: false,
			manifestUpdated: true,
		});
	} finally {
		restoreSpawn();
	}
});

test("js_dep_add dev=false: same argv as dev absent", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		calls.length = 0;
		scripted = fakeChild(0);
		const out = envelope(
			await jsDepAdd({ packages: ["left-pad"], dev: false }, undefined, ws),
		);
		assert.equal(out.isError, false, out.text);
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0]?.args, [
			"install",
			"--ignore-scripts",
			"left-pad",
		]);
		assert.deepEqual(out.details, {
			packages: ["left-pad"],
			dev: false,
			manifestUpdated: true,
		});
	} finally {
		restoreSpawn();
	}
});

test("js_dep_add dev=true: --save-dev comes after --ignore-scripts (F2 order)", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		calls.length = 0;
		scripted = fakeChild(0);
		const out = envelope(
			await jsDepAdd({ packages: ["@scope/pkg"], dev: true }, undefined, ws),
		);
		assert.equal(out.isError, false, out.text);
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0]?.args, [
			"install",
			"--ignore-scripts",
			"--save-dev",
			"@scope/pkg",
		]);
		assert.deepEqual(out.details, {
			packages: ["@scope/pkg"],
			dev: true,
			manifestUpdated: true,
		});
	} finally {
		restoreSpawn();
	}
});

test("js_dep_remove: exact argv npm uninstall --ignore-scripts <name>", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		calls.length = 0;
		scripted = fakeChild(0);
		const out = envelope(
			await jsDepRemove({ packages: ["left-pad"] }, undefined, ws),
		);
		assert.equal(out.isError, false, out.text);
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.program, "npm");
		assert.deepEqual(calls[0]?.args, [
			"uninstall",
			"--ignore-scripts",
			"left-pad",
		]);
		assert.deepEqual(out.details, {
			packages: ["left-pad"],
			manifestUpdated: true,
		});
	} finally {
		restoreSpawn();
	}
});

// --- the load-bearing control: npm name grammar (F5) ---
const INVALID_NAMES = [
	"", // empty
	" ", // whitespace only
	"pkg name", // embedded whitespace
	"pkg@1.2.3", // version specifier
	"pkg@^1.0.0", // range
	"pkg@next", // dist-tag
	"@scope/pkg@1", // version on a scoped name
	"https://registry.example/pkg.tgz", // URL
	"git+https://github.com/user/repo", // git specifier
	"github:user/repo", // github shorthand
	"user/repo#v1", // path + fragment
	"npm:other@1", // npm alias
	"Lodash", // uppercase
	".pkg", // leading dot
	"-pkg", // leading dash (option injection via bare argv)
	"a/b/c", // deep path
	"@scope/", // scope without name
	"/name", // leading slash
	"a;b", // argv-hostile punctuation
	"npm:other", // alias without version
	"a".repeat(215), // over the 214-char npm cap
];

test("name grammar: every rejected form -> INVALID_ARGUMENT with zero spawns", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		for (const name of INVALID_NAMES) {
			calls.length = 0;
			const add = envelope(await jsDepAdd({ packages: [name] }, undefined, ws));
			assert.equal(add.isError, true, `expected rejection: ${name}`);
			assert.equal(add.details.code, "INVALID_ARGUMENT", name);
			const rm = envelope(
				await jsDepRemove({ packages: [name] }, undefined, ws),
			);
			assert.equal(rm.isError, true, `expected rejection: ${name}`);
			assert.equal(rm.details.code, "INVALID_ARGUMENT", name);
			assert.equal(calls.length, 0, `no spawn for rejected name: ${name}`);
		}
	} finally {
		restoreSpawn();
	}
});

test("name grammar: valid bare and scoped names are accepted and spawn", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		calls.length = 0;
		scripted = fakeChild(0);
		const out = envelope(
			await jsDepAdd(
				{ packages: ["lodash", "@scope/name", "a.b-c_d", "@a/b.c"] },
				undefined,
				ws,
			),
		);
		assert.equal(out.isError, false, out.text);
		assert.deepEqual(out.details.packages, [
			"lodash",
			"@scope/name",
			"a.b-c_d",
			"@a/b.c",
		]);
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0]?.args, [
			"install",
			"--ignore-scripts",
			"lodash",
			"@scope/name",
			"a.b-c_d",
			"@a/b.c",
		]);
	} finally {
		restoreSpawn();
	}
});

test(`21 packages -> LIMIT_EXCEEDED with zero spawns`, async () => {
	const ws = workspace();
	const packages = Array.from(
		{ length: MAX_DEP_PACKAGES + 1 },
		(_, i) => `pkg${i}`,
	);
	installSpawnInterceptor();
	calls.length = 0;
	try {
		const out = envelope(await jsDepAdd({ packages }, undefined, ws));
		assert.equal(out.isError, true);
		assert.equal(out.details.code, "LIMIT_EXCEEDED");
		assert.equal(calls.length, 0);
		const rm = envelope(await jsDepRemove({ packages }, undefined, ws));
		assert.equal(rm.isError, true);
		assert.equal(rm.details.code, "LIMIT_EXCEEDED");
		assert.equal(calls.length, 0);
	} finally {
		restoreSpawn();
	}
});

// --- CAPABILITY_GAP: table miss, before any spawn (F6) ---
test("unsupported manager (pnpm/yarn/bun) -> CAPABILITY_GAP with zero spawns", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		for (const manager of ["pnpm", "yarn", "bun"]) {
			calls.length = 0;
			const add = envelope(
				await jsDepAdd({ packages: ["left-pad"] }, undefined, ws, manager),
			);
			assert.equal(add.isError, true, manager);
			assert.equal(add.details.code, "CAPABILITY_GAP", manager);
			const rm = envelope(
				await jsDepRemove({ packages: ["left-pad"] }, undefined, ws, manager),
			);
			assert.equal(rm.isError, true, manager);
			assert.equal(rm.details.code, "CAPABILITY_GAP", manager);
			assert.equal(calls.length, 0, manager);
		}
	} finally {
		restoreSpawn();
	}
});

test("a table entry missing the requested verb -> CAPABILITY_GAP with zero spawns", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		calls.length = 0;
		JS_PACKAGE_MANAGERS["broken"] = {
			add: { program: "broken", args: ["add"] },
		} as DepCommands; // no addDev, no remove
		const addDev = envelope(
			await jsDepAdd(
				{ packages: ["left-pad"], dev: true },
				undefined,
				ws,
				"broken",
			),
		);
		assert.equal(addDev.isError, true);
		assert.equal(addDev.details.code, "CAPABILITY_GAP");
		const remove = envelope(
			await jsDepRemove({ packages: ["left-pad"] }, undefined, ws, "broken"),
		);
		assert.equal(remove.isError, true);
		assert.equal(remove.details.code, "CAPABILITY_GAP");
		assert.equal(calls.length, 0);
	} finally {
		delete JS_PACKAGE_MANAGERS["broken"];
		restoreSpawn();
	}
});

// --- outcome handling ---
test("scripted exit 3 -> VALIDATION_FAILED with stderr", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		calls.length = 0;
		scripted = fakeChild(3, "", "E404 not found");
		const out = envelope(
			await jsDepAdd({ packages: ["left-pad"] }, undefined, ws),
		);
		assert.equal(out.isError, true);
		assert.equal(out.details.code, "VALIDATION_FAILED");
		assert.ok(String(out.details.message).includes("exit 3"));
		assert.ok(String(out.details.message).includes("E404"));
	} finally {
		restoreSpawn();
	}
});

test("slow child + short timeout override -> TIMEOUT", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		calls.length = 0;
		scripted = slowChild();
		const out = envelope(
			await jsDepAdd({ packages: ["left-pad"] }, undefined, ws, "npm", 10),
		);
		assert.equal(out.isError, true);
		assert.equal(out.details.code, "TIMEOUT");
	} finally {
		restoreSpawn();
	}
});

// --- schema key audit (F3): no backend/flag/version key anywhere ---
const FORBIDDEN_KEYS = [
	"backend",
	"manager",
	"version",
	"spec",
	"range",
	"flag",
	"flags",
	"args",
	"argv",
	"command",
	"program",
	"executable",
	"config",
	"shell",
	"registry",
	"index",
];
function collectKeys(node: unknown, into: Set<string>): void {
	if (typeof node !== "object" || node === null) return;
	if (Array.isArray(node)) {
		for (const item of node) collectKeys(item, into);
		return;
	}
	for (const [key, value] of Object.entries(node)) {
		into.add(key);
		collectKeys(value, into);
	}
}
test("schema key audit: dep tool parameters expose only packages (+dev on add)", () => {
	const forbidden = new Set<string>();
	collectKeys(jsDepAddTool.parameters, forbidden);
	collectKeys(jsDepRemoveTool.parameters, forbidden);
	for (const key of FORBIDDEN_KEYS)
		assert.equal(forbidden.has(key), false, `forbidden schema key: ${key}`);
});

// --- argv sweep: --ignore-scripts always present for npm, never a `--` before names ---
test("argv sweep: every npm argv keeps --ignore-scripts and has no -- separator", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		calls.length = 0;
		scripted = fakeChild(0);
		await jsDepAdd({ packages: ["a"] }, undefined, ws);
		await jsDepAdd({ packages: ["a"], dev: true }, undefined, ws);
		await jsDepRemove({ packages: ["a"] }, undefined, ws);
		assert.equal(calls.length, 3);
		for (const call of calls) {
			assert.equal(call.program, "npm");
			assert.equal(
				call.args.includes("--ignore-scripts"),
				true,
				JSON.stringify(call.args),
			);
			assert.equal(call.args.includes("--"), false);
		}
	} finally {
		restoreSpawn();
	}
});

// --- registration: config-driven, envelope conventions, order frozen (F7) ---
type RegisteredTool = {
	name: string;
	execute: (...args: unknown[]) => Promise<{
		isError?: boolean;
		content: Array<{ text?: string }>;
		details: unknown;
	}>;
};
function mockRegistrar() {
	const registered: RegisteredTool[] = [];
	const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
	const pi = {
		on(event: string, handler: (...args: unknown[]) => unknown) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
		registerTool: (tool: RegisteredTool) => registered.push(tool),
	} as unknown as ExtensionAPI;
	return { pi, registered, fire };
	function fire(event: string, ctx: unknown): void {
		for (const h of handlers.get(event) ?? []) h({}, ctx);
	}
}

function writeCompanionConfig(ws: string, packageManager: string): void {
	mkdirSync(path.join(ws, ".pi"), { recursive: true });
	writeFileSync(
		path.join(ws, ".pi", "pi-nobash-companions.json"),
		JSON.stringify({
			companions: {
				javascript: {
					formatter: "prettier",
					linter: "biome",
					packageManager,
				},
				python: { formatter: "ruff", linter: "ruff", packageManager: "uv" },
			},
		}),
	);
}

test("registration: js dep tools are config-driven, last, and annotations carry destructiveHint", () => {
	const ws = workspace();
	writeCompanionConfig(ws, "npm");
	const { pi, registered } = mockRegistrar();
	registerJsTools(pi);
	assert.deepEqual(
		registered.map((t) => t.name),
		["js_format_write", "js_lint_fix", "js_dep_add", "js_dep_remove"],
	);
	for (const name of ["js_dep_add", "js_dep_remove"]) {
		const tool = registered.find((t) => t.name === name);
		assert.ok(tool, `${name} must be registered`);
		const def = name === "js_dep_add" ? jsDepAddTool : jsDepRemoveTool;
		assert.equal(def.exposure, "direct");
		assert.equal(def.defaultActive, false);
		assert.equal(def.annotations?.readOnlyHint, false);
		assert.equal(def.annotations?.destructiveHint, true);
		assert.ok(
			typeof def.promptSnippet === "string" &&
				!def.promptSnippet.includes("\n"),
			`${name} promptSnippet must be one line`,
		);
	}
});

test("config boundary: packageManager pnpm -> PARSE_ERROR envelope with zero spawns", async () => {
	const ws = workspace();
	writeCompanionConfig(ws, "pnpm");
	const { pi, registered, fire } = mockRegistrar();
	registerJsTools(pi);
	const ctx = {
		cwd: ws,
		sessionManager: { getSessionId: () => "dep-test-pnpm" },
	};
	fire("session_start", ctx);
	installSpawnInterceptor();
	try {
		calls.length = 0;
		const tool = registered.find((t) => t.name === "js_dep_add");
		assert.ok(tool);
		const result = await tool.execute(
			"id",
			{ packages: ["left-pad"] },
			undefined,
			undefined,
			ctx,
		);
		const out = envelope(result);
		assert.equal(out.isError, true);
		assert.equal(out.details.code, "PARSE_ERROR");
		assert.equal(calls.length, 0);
	} finally {
		restoreSpawn();
	}
});
