import assert from "node:assert/strict";
import fs, {
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
	JS_FORMATTERS,
	loadCompanionConfig,
	PY_FORMATTERS,
	type ToolCtx,
} from "../../../companions/config.ts";

const dirs: string[] = [];
function workspace(): string {
	const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "pi-nobash-cfg-")));
	dirs.push(dir);
	mkdirSync(path.join(dir, ".pi"), { recursive: true });
	return dir;
}
function writeConfig(ws: string, content: unknown): void {
	writeFileSync(
		path.join(ws, ".pi", "pi-nobash-companions.json"),
		typeof content === "string" ? content : JSON.stringify(content),
	);
}
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Minimal mock pi: collects event handlers like tests/integration/helpers.ts createMockPi.
function mockPi(): {
	pi: ExtensionAPI;
	fire(event: string, ctx: unknown): void;
} {
	const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
	const pi = {
		on(event: string, handler: (...args: unknown[]) => unknown) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
	} as unknown as ExtensionAPI;
	return {
		pi,
		fire(event: string, ctx: unknown): void {
			for (const h of handlers.get(event) ?? []) h({}, ctx);
		},
	};
}
// Unique session ids per call: the snapshot cache is module-level, so tests
// must never share an id.
let sessionSeq = 0;
function ctxFor(cwd: string, id = `s${++sessionSeq}`): ToolCtx {
	return { cwd, sessionManager: { getSessionId: () => id } };
}

test("missing config file -> defaults (prettier, ruff)", () => {
	const ws = workspace();
	const cfg = loadCompanionConfig(ws);
	assert.equal(cfg.javascript.formatter, "prettier");
	assert.equal(cfg.javascript.linter, "biome");
	assert.equal(cfg.javascript.packageManager, "npm");
	assert.equal(cfg.python.formatter, "ruff");
	assert.equal(cfg.python.linter, "ruff");
	assert.equal(cfg.python.packageManager, "uv");
});

test("formatter: biome resolves through the fixed builder table", () => {
	const ws = workspace();
	writeConfig(ws, {
		companions: {
			javascript: {
				formatter: "biome",
				linter: "biome",
				packageManager: "npm",
			},
			python: { formatter: "ruff", linter: "ruff", packageManager: "uv" },
		},
	});
	const cfg = loadCompanionConfig(ws);
	assert.equal(cfg.javascript.formatter, "biome");
	assert.deepEqual(JS_FORMATTERS[cfg.javascript.formatter], {
		program: "npx",
		args: ["biome", "format", "--write", "--"],
	});
	assert.deepEqual(JS_FORMATTERS.prettier, {
		program: "npx",
		args: ["prettier", "--write", "--"],
	});
	assert.deepEqual(PY_FORMATTERS.ruff, {
		program: "ruff",
		args: ["format", "--"],
	});
});

test("mid-session edit to the config file is ignored (session snapshot)", () => {
	const ws = workspace();
	writeConfig(ws, {
		companions: {
			javascript: {
				formatter: "biome",
				linter: "biome",
				packageManager: "npm",
			},
			python: { formatter: "ruff", linter: "ruff", packageManager: "uv" },
		},
	});
	const { pi, fire } = mockPi();
	const getConfig = bindCompanionConfig(pi, ws);
	const ctx = ctxFor(ws); // same session id for the post-edit getter call
	fire("session_start", ctx);
	// Edit after session_start: the loaded snapshot must not change.
	writeConfig(ws, {
		companions: {
			javascript: {
				formatter: "prettier",
				linter: "biome",
				packageManager: "npm",
			},
			python: { formatter: "ruff", linter: "ruff", packageManager: "uv" },
		},
	});
	assert.equal(getConfig(ctx).javascript.formatter, "biome");
});

test("malformed JSON / unknown key / non-enum value -> PARSE_ERROR", () => {
	const cases: Array<[string, string]> = [
		["malformed JSON", "{ companions: {"],
		["unknown top-level key", JSON.stringify({ companions: {}, extra: 1 })],
		[
			"unknown nested key",
			JSON.stringify({
				companions: { javascript: { formatter: "prettier", bogus: 1 } },
			}),
		],
		[
			"unknown stack key",
			JSON.stringify({ companions: { rust: { formatter: "rustfmt" } } }),
		],
		[
			"non-enum formatter",
			JSON.stringify({
				companions: { javascript: { formatter: "clang-format" } },
			}),
		],
		[
			"non-enum linter",
			JSON.stringify({
				companions: { javascript: { linter: "tslint" } },
			}),
		],
		[
			"non-enum packageManager",
			JSON.stringify({
				companions: { python: { packageManager: "poetry" } },
			}),
		],
	];
	for (const [label, content] of cases) {
		const ws = workspace();
		writeConfig(ws, content);
		assert.throws(
			() => loadCompanionConfig(ws),
			(err: unknown) =>
				err instanceof Error &&
				(err as { code?: string }).code === "PARSE_ERROR",
			`expected PARSE_ERROR for ${label}`,
		);
	}
});

test("foreign ctx.cwd -> INVALID_ARGUMENT, not a lazy load", () => {
	const ws = workspace();
	const other = workspace();
	writeConfig(ws, {
		companions: {
			javascript: {
				formatter: "biome",
				linter: "biome",
				packageManager: "npm",
			},
			python: { formatter: "ruff", linter: "ruff", packageManager: "uv" },
		},
	});
	const { pi, fire } = mockPi();
	const getConfig = bindCompanionConfig(pi, ws);
	fire("session_start", ctxFor(ws));
	assert.throws(
		() => getConfig(ctxFor(other)),
		(err: unknown) =>
			err instanceof Error &&
			(err as { code?: string }).code === "INVALID_ARGUMENT" &&
			err.message.includes("no companion config loaded for this workspace"),
	);
	// Same directory via a different path string still resolves (normalizeCwd).
	assert.equal(getConfig(ctxFor(ws)).javascript.formatter, "biome");
});

test("session_shutdown releases the snapshot; registration-cwd fallback works", () => {
	const ws = workspace();
	writeConfig(ws, {
		companions: {
			javascript: {
				formatter: "biome",
				linter: "biome",
				packageManager: "npm",
			},
			python: { formatter: "ruff", linter: "ruff", packageManager: "uv" },
		},
	});
	const { pi, fire } = mockPi();
	const getConfig = bindCompanionConfig(pi, ws);
	// No session started: direct-caller fallback reads the registration cwd.
	assert.equal(getConfig(ctxFor(ws)).javascript.formatter, "biome");
	fire("session_start", ctxFor(ws, "s9"));
	fire("session_shutdown", ctxFor(ws, "s9"));
	// After shutdown the session is gone; the fallback still serves the caller.
	assert.equal(getConfig(ctxFor(ws)).javascript.formatter, "biome");
});

test("no config value can yield a program or argv (enum->builder tables are closed)", () => {
	// The tables are keyed only by enumerated names and hold frozen literals.
	assert.deepEqual(Object.keys(JS_FORMATTERS).sort(), ["biome", "prettier"]);
	assert.deepEqual(Object.keys(PY_FORMATTERS), ["ruff"]);
	for (const inv of Object.values(JS_FORMATTERS)) {
		assert.equal(inv.program, "npx");
		assert.ok(Array.isArray(inv.args));
	}
	for (const inv of Object.values(PY_FORMATTERS)) {
		assert.equal(inv.program, "ruff");
	}
	// Resolved config exposes enumerated names only — never a program or argv.
	const ws = workspace();
	const cfg = loadCompanionConfig(ws);
	assert.deepEqual(Object.keys(cfg.javascript), [
		"formatter",
		"linter",
		"packageManager",
	]);
	assert.deepEqual(Object.keys(cfg.python), [
		"formatter",
		"linter",
		"packageManager",
	]);
});

test("two binders + one session_start -> config file read exactly once (F2b)", () => {
	const ws = workspace();
	writeConfig(ws, {
		companions: {
			javascript: {
				formatter: "biome",
				linter: "biome",
				packageManager: "npm",
			},
			python: { formatter: "ruff", linter: "ruff", packageManager: "uv" },
		},
	});
	const realRead = fs.readFileSync;
	let configReads = 0;
	fs.readFileSync = ((file: unknown, ...rest: unknown[]) => {
		if (String(file).endsWith("pi-nobash-companions.json")) configReads++;
		return (realRead as (...a: unknown[]) => unknown)(file, ...rest) as string;
	}) as typeof fs.readFileSync;
	try {
		const { pi, fire } = mockPi();
		// Two registrars loaded: each calls bindCompanionConfig -> two binders.
		const getJs = bindCompanionConfig(pi, ws);
		const getPy = bindCompanionConfig(pi, ws);
		fire("session_start", ctxFor(ws, "shared-s1"));
		fire("session_start", ctxFor(ws, "shared-s1"));
		assert.equal(configReads, 1, "config file must be read once per session");
		const js = getJs(ctxFor(ws, "shared-s1"));
		const py = getPy(ctxFor(ws, "shared-s1"));
		assert.equal(js.javascript.formatter, "biome");
		assert.equal(py.python.formatter, "ruff");
		// Mid-session edit still cannot change the shared snapshot.
		writeConfig(ws, {
			companions: {
				javascript: {
					formatter: "prettier",
					linter: "biome",
					packageManager: "npm",
				},
				python: { formatter: "ruff", linter: "ruff", packageManager: "uv" },
			},
		});
		assert.equal(getJs(ctxFor(ws, "shared-s1")).javascript.formatter, "biome");
		assert.equal(configReads, 1);
	} finally {
		fs.readFileSync = realRead;
	}
});

test("criterion 4: zero reads at bind, one read per session id at session_start", () => {
	const ws = workspace();
	writeConfig(ws, {
		companions: {
			javascript: {
				formatter: "biome",
				linter: "biome",
				packageManager: "npm",
			},
			python: { formatter: "ruff", linter: "ruff", packageManager: "uv" },
		},
	});
	const realRead = fs.readFileSync;
	let reads = 0;
	fs.readFileSync = ((file: unknown, ...rest: unknown[]) => {
		if (String(file).endsWith("pi-nobash-companions.json")) reads++;
		return (realRead as (...a: unknown[]) => unknown)(file, ...rest) as string;
	}) as typeof fs.readFileSync;
	try {
		const { pi, fire } = mockPi();
		const getJs = bindCompanionConfig(pi, ws);
		const getPy = bindCompanionConfig(pi, ws);
		assert.equal(reads, 0, "bind time must not read");
		fire("session_start", ctxFor(ws, "sess-A"));
		assert.equal(reads, 1, "first session_start reads once");
		fire("session_start", ctxFor(ws, "sess-A"));
		assert.equal(reads, 1, "second binder for the same id reuses the read");
		assert.equal(getJs(ctxFor(ws, "sess-A")).javascript.formatter, "biome");
		assert.equal(getPy(ctxFor(ws, "sess-A")).javascript.formatter, "biome");
		assert.equal(reads, 1);
		// A different session id re-reads even in the same cwd.
		fire("session_start", ctxFor(ws, "sess-B"));
		assert.equal(
			reads,
			2,
			"new session id reads again (per-session semantics)",
		);
		// Mid-session edit: snapshot unchanged, no extra read.
		writeConfig(ws, {
			companions: {
				javascript: {
					formatter: "prettier",
					linter: "biome",
					packageManager: "npm",
				},
				python: { formatter: "ruff", linter: "ruff", packageManager: "uv" },
			},
		});
		assert.equal(getJs(ctxFor(ws, "sess-A")).javascript.formatter, "biome");
		assert.equal(reads, 2);
	} finally {
		fs.readFileSync = realRead;
	}
});

test("criterion 4: direct-caller fallback is lazy and still scope-checks", () => {
	const ws = workspace();
	const other = workspace();
	writeConfig(ws, {
		companions: {
			javascript: {
				formatter: "biome",
				linter: "biome",
				packageManager: "npm",
			},
			python: { formatter: "ruff", linter: "ruff", packageManager: "uv" },
		},
	});
	const realRead = fs.readFileSync;
	let reads = 0;
	fs.readFileSync = ((file: unknown, ...rest: unknown[]) => {
		if (String(file).endsWith("pi-nobash-companions.json")) reads++;
		return (realRead as (...a: unknown[]) => unknown)(file, ...rest) as string;
	}) as typeof fs.readFileSync;
	try {
		const { pi } = mockPi();
		const getJs = bindCompanionConfig(pi, ws);
		assert.equal(reads, 0, "no eager read at bind time");
		assert.equal(getJs(ctxFor(ws)).javascript.formatter, "biome");
		assert.equal(reads, 1, "fallback reads lazily on first getter call");
		assert.equal(getJs(ctxFor(ws)).javascript.formatter, "biome");
		assert.equal(reads, 1, "fallback cached per binder afterwards");
		assert.throws(
			() => getJs(ctxFor(other)),
			(err: unknown) =>
				err instanceof Error &&
				(err as { code?: string }).code === "INVALID_ARGUMENT",
		);
		assert.equal(reads, 1, "foreign-cwd rejection performs no read");
	} finally {
		fs.readFileSync = realRead;
	}
});

test("FD5: a partial stack uses per-key defaults (all keys optional)", () => {
	const ws = workspace();
	writeConfig(ws, { companions: { javascript: { formatter: "biome" } } });
	const cfg = loadCompanionConfig(ws);
	assert.equal(cfg.javascript.formatter, "biome");
	assert.equal(cfg.javascript.linter, "biome");
	assert.equal(cfg.javascript.packageManager, "npm");
	assert.equal(cfg.python.formatter, "ruff");
	assert.equal(cfg.python.linter, "ruff");
	assert.equal(cfg.python.packageManager, "uv");
	// The partial value still yields the fixed Biome argv, never a program.
	assert.deepEqual(JS_FORMATTERS[cfg.javascript.formatter], {
		program: "npx",
		args: ["biome", "format", "--write", "--"],
	});
});
