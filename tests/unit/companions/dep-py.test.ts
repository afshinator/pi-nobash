import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
	type DepCommands,
	PY_PACKAGE_MANAGERS,
} from "../../../companions/config.ts";
import {
	MAX_DEP_PACKAGES,
	pyDepAdd,
	pyDepAddTool,
	pyDepRemove,
	pyDepRemoveTool,
} from "../../../companions/python/dep.ts";

const dirs: string[] = [];
function workspace(): string {
	const dir = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-pydep-")),
	);
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

// --- exact argv (F2): frozen table args, names last, no `--` separator ---
test("py_dep_add dev absent: exact argv uv add <name>", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		calls.length = 0;
		scripted = fakeChild(0);
		const out = envelope(
			await pyDepAdd({ packages: ["left-pad"] }, undefined, ws),
		);
		assert.equal(out.isError, false, out.text);
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.program, "uv");
		assert.deepEqual(calls[0]?.args, ["add", "left-pad"]);
		assert.equal(calls[0]?.args.includes("--"), false);
		assert.deepEqual(out.details, { packages: ["left-pad"], dev: false });
	} finally {
		restoreSpawn();
	}
});

test("py_dep_add dev=false: same argv as dev absent", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		calls.length = 0;
		scripted = fakeChild(0);
		const out = envelope(
			await pyDepAdd({ packages: ["left-pad"], dev: false }, undefined, ws),
		);
		assert.equal(out.isError, false, out.text);
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0]?.args, ["add", "left-pad"]);
		assert.deepEqual(out.details, { packages: ["left-pad"], dev: false });
	} finally {
		restoreSpawn();
	}
});

test("py_dep_add dev=true: exact argv uv add --dev <name>", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		calls.length = 0;
		scripted = fakeChild(0);
		const out = envelope(
			await pyDepAdd(
				{ packages: ["pytest", "ruff"], dev: true },
				undefined,
				ws,
			),
		);
		assert.equal(out.isError, false, out.text);
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.program, "uv");
		assert.deepEqual(calls[0]?.args, ["add", "--dev", "pytest", "ruff"]);
		assert.equal(calls[0]?.args.includes("--"), false);
		assert.deepEqual(out.details, {
			packages: ["pytest", "ruff"],
			dev: true,
		});
	} finally {
		restoreSpawn();
	}
});

test("py_dep_remove: exact argv uv remove <name>, details without dev", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		calls.length = 0;
		scripted = fakeChild(0);
		const out = envelope(
			await pyDepRemove({ packages: ["left-pad"] }, undefined, ws),
		);
		assert.equal(out.isError, false, out.text);
		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.program, "uv");
		assert.deepEqual(calls[0]?.args, ["remove", "left-pad"]);
		assert.equal(calls[0]?.args.includes("--"), false);
		assert.deepEqual(out.details, { packages: ["left-pad"] });
	} finally {
		restoreSpawn();
	}
});

// --- the load-bearing control: PEP 508 name grammar (F5) ---
const INVALID_NAMES = [
	"", // empty
	" ", // whitespace only
	"pkg name", // embedded whitespace
	"pkg>=2", // version specifier
	"pkg==2.0", // exact pin
	"pkg[foo]", // extras
	"pkg @ file:///tmp/pkg", // PEP 508 direct reference
	"pkg,fork", // comma list
	"pkg; python_version<'3'", // environment marker
	".pkg", // leading dot
	"-pkg", // leading dash (option injection via bare argv)
	"_pkg", // leading underscore (PEP 508 forbids non-alphanumeric first char)
	"a;b", // shell-ish punctuation
	"$(x)", // substitution-looking
	"pkg/../other", // path-ish
	"pkg*", // glob char
	// URL / VCS rows last: the remote-guard scanner tolerates URL literals only
	// within 14 lines of a coded rejection, which follows below.
	"https://example.com/pkg.whl", // URL
	"git+https://github.com/user/repo", // VCS
	"git+ssh://git@github.com/user/repo.git", // VCS over ssh
];

test("PEP 508 grammar: every rejected form -> INVALID_ARGUMENT with zero spawns", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		for (const name of INVALID_NAMES) {
			calls.length = 0;
			const add = envelope(await pyDepAdd({ packages: [name] }, undefined, ws));
			assert.equal(add.isError, true, `expected rejection: ${name}`);
			assert.equal(add.details.code, "INVALID_ARGUMENT", name);
			const rm = envelope(
				await pyDepRemove({ packages: [name] }, undefined, ws),
			);
			assert.equal(rm.isError, true, `expected rejection: ${name}`);
			assert.equal(rm.details.code, "INVALID_ARGUMENT", name);
			assert.equal(calls.length, 0, `no spawn for rejected name: ${name}`);
		}
	} finally {
		restoreSpawn();
	}
});

test("PEP 508 grammar: uppercase names and dots/dashes are accepted and spawn", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		calls.length = 0;
		scripted = fakeChild(0);
		const accepted = [
			"Django",
			"Flask",
			"PyYAML",
			"zope.interface",
			"ruamel.yaml",
			"a.b-c_d",
			"pkg1",
		];
		const out = envelope(await pyDepAdd({ packages: accepted }, undefined, ws));
		assert.equal(out.isError, false, out.text);
		assert.deepEqual(out.details.packages, accepted);
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0]?.args, ["add", ...accepted]);
	} finally {
		restoreSpawn();
	}
});

test("21 packages -> LIMIT_EXCEEDED with zero spawns", async () => {
	const ws = workspace();
	const packages = Array.from(
		{ length: MAX_DEP_PACKAGES + 1 },
		(_, i) => `pkg${i}`,
	);
	installSpawnInterceptor();
	calls.length = 0;
	try {
		const out = envelope(await pyDepAdd({ packages }, undefined, ws));
		assert.equal(out.isError, true);
		assert.equal(out.details.code, "LIMIT_EXCEEDED");
		assert.equal(calls.length, 0);
		const rm = envelope(await pyDepRemove({ packages }, undefined, ws));
		assert.equal(rm.isError, true);
		assert.equal(rm.details.code, "LIMIT_EXCEEDED");
		assert.equal(calls.length, 0);
	} finally {
		restoreSpawn();
	}
});

// --- CAPABILITY_GAP: table miss, before any spawn (F6) ---
test("unsupported manager (poetry/pipenv/pip) -> CAPABILITY_GAP with zero spawns", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		for (const manager of ["poetry", "pipenv", "pip"]) {
			calls.length = 0;
			const add = envelope(
				await pyDepAdd({ packages: ["left-pad"] }, undefined, ws, manager),
			);
			assert.equal(add.isError, true, manager);
			assert.equal(add.details.code, "CAPABILITY_GAP", manager);
			const rm = envelope(
				await pyDepRemove({ packages: ["left-pad"] }, undefined, ws, manager),
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
		PY_PACKAGE_MANAGERS.broken = {
			add: { program: "broken", args: ["add"] },
		} as DepCommands; // no addDev, no remove
		const addDev = envelope(
			await pyDepAdd(
				{ packages: ["left-pad"], dev: true },
				undefined,
				ws,
				"broken",
			),
		);
		assert.equal(addDev.isError, true);
		assert.equal(addDev.details.code, "CAPABILITY_GAP");
		const remove = envelope(
			await pyDepRemove({ packages: ["left-pad"] }, undefined, ws, "broken"),
		);
		assert.equal(remove.isError, true);
		assert.equal(remove.details.code, "CAPABILITY_GAP");
		assert.equal(calls.length, 0);
	} finally {
		delete PY_PACKAGE_MANAGERS.broken;
		restoreSpawn();
	}
});

// --- outcome handling ---
test("scripted exit 3 -> VALIDATION_FAILED with stderr", async () => {
	const ws = workspace();
	installSpawnInterceptor();
	try {
		calls.length = 0;
		scripted = fakeChild(
			3,
			"",
			"No solution found when resolving dependencies",
		);
		const out = envelope(
			await pyDepAdd({ packages: ["left-pad"] }, undefined, ws),
		);
		assert.equal(out.isError, true);
		assert.equal(out.details.code, "VALIDATION_FAILED");
		assert.ok(String(out.details.message).includes("uv add"));
		assert.ok(String(out.details.message).includes("exit 3"));
		assert.ok(String(out.details.message).includes("No solution found"));
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
			await pyDepAdd({ packages: ["left-pad"] }, undefined, ws, "uv", 10),
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
test("schema key audit: py dep parameters expose only packages (+dev on add)", () => {
	const seen = new Set<string>();
	collectKeys(pyDepAddTool.parameters, seen);
	collectKeys(pyDepRemoveTool.parameters, seen);
	for (const key of FORBIDDEN_KEYS)
		assert.equal(seen.has(key), false, `forbidden schema key: ${key}`);
	collectKeys(pyDepRemoveTool.parameters, seen);
	assert.equal(seen.has("dev"), true, "dev comes from the add schema");
});

test("py dep tool defs: direct, defaultActive false, destructive, one-line snippet", () => {
	for (const def of [pyDepAddTool, pyDepRemoveTool]) {
		assert.equal(def.exposure, "direct");
		assert.equal(def.defaultActive, false);
		assert.equal(def.annotations?.readOnlyHint, false);
		assert.equal(def.annotations?.destructiveHint, true);
		assert.ok(
			typeof def.promptSnippet === "string" &&
				!def.promptSnippet.includes("\n"),
			`${def.name} promptSnippet must be one line`,
		);
	}
});
