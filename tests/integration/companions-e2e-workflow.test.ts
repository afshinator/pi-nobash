/**
 * A6 no-shell E2E: one full workflow loop through a fixture repo using ONLY
 * typed tools (core entry + companions registered into one fake-pi
 * registry), with every spawned process recorded.
 *
 * Frozen backends only: git (companion mutation tools), npx (Biome), ruff.
 * Core tools (git_status, git_diff, run_validation) spawn via ESM named
 * imports, which cannot be intercepted; they are excluded from the recorder's
 * view by construction — every RECORDED spawn must be a frozen backend.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGitMutationTools } from "../../companions/git/index.ts";
import { registerJsTools } from "../../companions/javascript/index.ts";
import { registerPythonTools } from "../../companions/python/index.ts";
import {
	createBareRemote,
	createTempGitRepo,
	gitIn,
	recordSpawns,
} from "../helpers/companion-harness.ts";

const CORE_ENTRY = "../../extensions/pi-nobash.ts";

type AnyTool = {
	name: string;
	execute: (
		id: string,
		params: unknown,
		signal?: unknown,
		onUpdate?: unknown,
		ctx?: unknown,
	) => Promise<{
		isError?: boolean;
		content: Array<{ text?: string }>;
		details: unknown;
	}>;
};

let repo: string;
let remote: string;
let cleanupRepo: () => void;
let cleanupRemote: () => void;
let oldCwd: string;
const SESSION = "e2e-session";
const ctx = {
	cwd: "", // set in before(), after chdir
	sessionManager: { getSessionId: () => SESSION },
};
let tools: Map<string, AnyTool>;

/** Coded error from a tool result envelope. */
function codeOf(result: {
	isError?: boolean;
	content: Array<{ text?: string }>;
	details: unknown;
}): string {
	assert.equal(result.isError, true, "probe must fail");
	const details = result.details as { code?: string };
	assert.ok(
		typeof details.code === "string",
		`coded error required: ${JSON.stringify(result.details)}`,
	);
	return details.code;
}

async function run(name: string, params: unknown) {
	const tool = tools.get(name);
	assert.ok(tool, `tool ${name} registered`);
	return tool.execute("id", params, undefined, undefined, ctx);
}

before(async () => {
	const r = createTempGitRepo();
	repo = r.dir;
	cleanupRepo = r.cleanup;
	const b = createBareRemote();
	remote = b.dir;
	cleanupRemote = b.cleanup;
	gitIn(repo, ["remote", "add", "origin", remote]);

	// Core validation config: one read-only check that spawns only git.
	mkdirSync(path.join(repo, ".pi"), { recursive: true });
	writeFileSync(
		path.join(repo, ".pi", "pi-nobash.json"),
		JSON.stringify({
			validation: {
				checks: {
					status: {
						program: "git",
						args: ["status", "--short"],
						cwd: ".",
						timeoutMs: 60_000,
						targets: { mode: "none" },
					},
				},
			},
		}),
	);
	// Companion config: Biome formatter (spawns npx).
	writeFileSync(
		path.join(repo, ".pi", "pi-nobash-companions.json"),
		JSON.stringify({
			companions: {
				javascript: {
					formatter: "biome",
					linter: "biome",
					packageManager: "npm",
				},
				python: { formatter: "ruff", linter: "ruff", packageManager: "uv" },
			},
		}),
	);

	// Core tools resolve cwd via process.cwd(); the E2E runs inside the fixture.
	oldCwd = process.cwd();
	process.chdir(repo);
	ctx.cwd = repo;

	const { default: factory } = (await import(CORE_ENTRY)) as {
		default: (pi: ExtensionAPI) => void;
	};
	const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
	const registered: AnyTool[] = [];
	const pi = {
		registerTool: (t: AnyTool) => registered.push(t),
		registerCommand: () => {},
		on: (event: string, handler: (...args: unknown[]) => unknown) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
	} as unknown as ExtensionAPI;
	factory(pi);
	registerGitMutationTools(pi);
	registerJsTools(pi);
	registerPythonTools(pi);
	tools = new Map(registered.map((t) => [t.name, t]));
	for (const h of handlers.get("session_start") ?? []) h({}, ctx);
});

after(() => {
	process.chdir(oldCwd);
	cleanupRepo();
	cleanupRemote();
});

test("A6 no-shell workflow: full loop spawns only git/npx, push lands on the bare remote", {
	timeout: 240_000,
}, async () => {
	const rec = recordSpawns();
	try {
		// 1. git_status
		const st = await run("git_status", {});
		assert.notEqual((st as { isError?: boolean }).isError, true);

		// 2. edit (fixture write standing in for the edit tool)
		writeFileSync(
			path.join(repo, "messy.ts"),
			"const   x=1\nfunction  f ( a ,b ) { return a+b }\n",
		);

		// 3. js_format_write (Biome via npx)
		const fmt = await run("js_format_write", { paths: ["messy.ts"] });
		assert.notEqual((fmt as { isError?: boolean }).isError, true);
		assert.equal(readFormatDetails(fmt).formatted.join(","), "messy.ts");

		// 4. git_diff
		const diff = await run("git_diff", { mode: "working" });
		assert.notEqual((diff as { isError?: boolean }).isError, true);

		// 5. git_add
		const add = await run("git_add", { paths: ["messy.ts"] });
		assert.notEqual((add as { isError?: boolean }).isError, true);

		// 6. git_commit
		const commit = await run("git_commit", { message: "feat: e2e loop" });
		assert.notEqual((commit as { isError?: boolean }).isError, true);

		// 7. git_push to the throwaway bare remote
		const push = await run("git_push", { remote: "origin", setUpstream: true });
		assert.notEqual((push as { isError?: boolean }).isError, true);

		// 8. run_validation (read-only git status check)
		const val = await run("run_validation", { check: "status" });
		assert.notEqual((val as { isError?: boolean }).isError, true);
	} finally {
		rec.restore();
	}

	// Every recorded spawn is a frozen backend; git AND npx both appear.
	const programs = rec.spawns.map((s) => s.program);
	for (const p of programs)
		assert.ok(
			p === "git" || p === "npx" || p === "ruff",
			`non-frozen program spawned: ${p} (${JSON.stringify(rec.spawns)})`,
		);
	assert.ok(
		programs.includes("git"),
		`git must spawn, got: ${JSON.stringify(rec.spawns)}`,
	);
	assert.ok(
		programs.includes("npx"),
		`npx must spawn, got: ${JSON.stringify(rec.spawns)}`,
	);
	for (const banned of ["node", "npm", "prettier", "bash", "sh"])
		assert.ok(!programs.includes(banned), `${banned} must never spawn`);

	// Exact frozen argv shapes seen on the recorded path.
	const argSets = rec.spawns.map((s) => s.args);
	assert.ok(
		argSets.some(
			(a) => JSON.stringify(a) === JSON.stringify(["add", "--", "messy.ts"]),
		),
		`git_add argv: ${JSON.stringify(argSets)}`,
	);
	assert.ok(
		argSets.some(
			(a) =>
				JSON.stringify(a) ===
				JSON.stringify(["commit", "-m", "feat: e2e loop"]),
		),
		`git_commit argv: ${JSON.stringify(argSets)}`,
	);
	assert.ok(
		argSets.some(
			(a) =>
				JSON.stringify(a) ===
				JSON.stringify(["push", "--set-upstream", "origin", "main"]),
		),
		`git_push argv: ${JSON.stringify(argSets)}`,
	);
	const npx = rec.spawns.find((s) => s.program === "npx");
	assert.ok(npx, "npx spawn recorded");
	assert.deepEqual(npx.args.slice(0, 4), ["biome", "format", "--write", "--"]);

	// The push really landed: bare remote tip equals the fixture repo HEAD.
	assert.equal(
		gitIn(remote, ["rev-parse", "refs/heads/main"]),
		gitIn(repo, ["rev-parse", "HEAD"]),
	);
});

test("A6 out-of-scope probes: coded errors with zero spawns", {
	timeout: 120_000,
}, async () => {
	const probes: Array<{ name: string; params: unknown; code: string }> = [
		{
			name: "git_push",
			params: { remote: "origin", force: true },
			code: "CAPABILITY_GAP",
		},
		// `all` is not a schema field; the tool rejects it as a missing-mode
		// INVALID_ARGUMENT (the expressible stage-everything probe, paths: ["."],
		// is CAPABILITY_GAP below).
		{ name: "git_add", params: { all: true }, code: "INVALID_ARGUMENT" },
		{ name: "git_add", params: { paths: ["."] }, code: "CAPABILITY_GAP" },
		{
			name: "js_format_write",
			params: { paths: ["../escape.ts"] },
			code: "PATH_OUT_OF_SCOPE",
		},
		{
			name: "js_format_write",
			params: { paths: ["pkg@1.2.3"] },
			code: "INVALID_ARGUMENT",
		},
	];
	for (const probe of probes) {
		const rec = recordSpawns();
		let result: {
			isError?: boolean;
			content: Array<{ text?: string }>;
			details: unknown;
		};
		try {
			result = await run(probe.name, probe.params);
		} finally {
			rec.restore();
		}
		assert.equal(
			codeOf(result),
			probe.code,
			`${probe.name} ${JSON.stringify(probe.params)}`,
		);
		assert.equal(
			rec.spawns.length,
			0,
			`${probe.name} must spawn nothing: ${JSON.stringify(rec.spawns)}`,
		);
	}
	// No state changed by any probe: remote tip is still the committed HEAD.
	assert.equal(
		gitIn(remote, ["rev-parse", "refs/heads/main"]),
		gitIn(repo, ["rev-parse", "HEAD"]),
	);
});

function readFormatDetails(result: unknown): {
	formatted: string[];
	truncated: boolean;
} {
	const details = (result as { details: unknown }).details as {
		formatted?: string[];
	};
	assert.ok(
		Array.isArray(details.formatted),
		`details: ${JSON.stringify(details)}`,
	);
	return details as { formatted: string[]; truncated: boolean };
}
