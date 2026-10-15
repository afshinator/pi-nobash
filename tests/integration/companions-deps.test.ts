/**
 * Offline integration for js_dep_add / js_dep_remove / expo_dep_add (P1-3..P1-5)
 * and py_dep_add / py_dep_remove (P1-6/P1-7).
 *
 * A clearly-labelled STUB `npm` / `npx` / `uv` on PATH records the exact argv
 * and writes a known package.json + lockfile (or pyproject.toml + uv.lock)
 * diff; assertions are byte-exact. The real-binary branch runs the REAL
 * npm/npx/uv only where the binary (and, for npm, the registry) is reachable,
 * and otherwise SKIPS with a printed reason.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
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
import { registerExpoTools } from "../../companions/expo/index.ts";
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

function writeCompanionConfig(ws: string): void {
	mkdirSync(path.join(ws, ".pi"), { recursive: true });
	writeFileSync(
		path.join(ws, ".pi", "pi-nobash-companions.json"),
		JSON.stringify({
			companions: {
				javascript: {
					formatter: "prettier",
					linter: "biome",
					packageManager: "npm",
				},
				python: { formatter: "ruff", linter: "ruff", packageManager: "uv" },
			},
		}),
	);
}

let sessionSeq = 0;
async function runTool(
	register: (pi: ExtensionAPI) => void,
	ws: string,
	name: string,
	params: Record<string, unknown>,
): Promise<{
	isError: boolean;
	text: string;
	details: Record<string, unknown>;
}> {
	const { pi, fire, registered } = mockRegistrar();
	register(pi);
	const sessionId = `deps-it-${++sessionSeq}`;
	const ctx = {
		cwd: ws,
		sessionManager: { getSessionId: () => sessionId },
	};
	fire("session_start", ctx);
	const tool = registered.find((t) => t.name === name);
	assert.ok(tool, `${name} must be registered`);
	const result = await tool.execute("id", params, undefined, undefined, ctx);
	return {
		isError: result.isError === true,
		text: result.content[0]?.text ?? "",
		details: result.details as Record<string, unknown>,
	};
}

/**
 * Writes a stub binary that records each argv element (one per line) and then
 * performs the scripted file mutation via the embedded node stub script.
 */
function writeStubBinary(
	binDir: string,
	name: string,
	nodeStub: string,
	marker: string,
): string {
	const stubPath = path.join(binDir, name);
	writeFileSync(
		stubPath,
		[
			"#!/usr/bin/env node",
			'import fs from "node:fs";',
			`fs.appendFileSync(${JSON.stringify(marker)}, process.argv.slice(2).map((a) => a + "\\n").join(""));`,
			nodeStub,
			"",
		].join("\n"),
	);
	chmodSync(stubPath, 0o755);
	return stubPath;
}

const STUB_NPM_ADD = `
const pkgPath = process.cwd() + "/package.json";
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const args = process.argv.slice(2);
const op = args[0];
const dev = args.includes("--save-dev");
const names = args.slice(1).filter((a) => !a.startsWith("-"));
if (op === "uninstall") {
	for (const n of names) delete pkg.dependencies?.[n];
} else {
	pkg.dependencies ??= {};
	for (const n of names) pkg.dependencies[n] = "1.3.0";
	delete pkg.devDependencies;
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\\n");
fs.writeFileSync(process.cwd() + "/package-lock.json", "stub-lock: " + op + " " + names.join(",") + "\\n");
`;

test("js_dep_add (STUB npm, not real npm): exact argv, exact package.json + lockfile diff", async () => {
	const ws = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-dep-it-")),
	);
	dirs.push(ws);
	const bin = mkdtempSync(path.join(tmpdir(), "pi-nobash-npm-bin-"));
	dirs.push(bin);
	const marker = path.join(bin, "npm-argv.txt");
	writeStubBinary(bin, "npm", STUB_NPM_ADD, marker);
	writeCompanionConfig(ws);
	const before = '{\n  "name": "fixture",\n  "version": "1.0.0"\n}\n';
	writeFileSync(path.join(ws, "package.json"), before);
	// Unrelated file: the tool must not touch anything but the manifest + lockfile.
	writeFileSync(path.join(ws, "README.md"), "unrelated\n");
	const realPathEnv = process.env.PATH;
	process.env.PATH = `${bin}:${realPathEnv}`;
	try {
		const out = await runTool(registerJsTools, ws, "js_dep_add", {
			packages: ["left-pad"],
		});
		assert.equal(out.isError, false, out.text);
		assert.deepEqual(out.details, {
			packages: ["left-pad"],
			dev: false,
			manifestUpdated: true,
		});

		// Exact frozen argv, element by element.
		assert.equal(
			readFileSync(marker, "utf8"),
			"install\n--ignore-scripts\nleft-pad\n",
		);
		// Exact manifest diff: dependency added, existing bytes otherwise kept.
		assert.equal(
			readFileSync(path.join(ws, "package.json"), "utf8"),
			'{\n  "name": "fixture",\n  "version": "1.0.0",\n  "dependencies": {\n    "left-pad": "1.3.0"\n  }\n}\n',
		);
		// Exact lockfile bytes written by the (stub) package manager.
		assert.equal(
			readFileSync(path.join(ws, "package-lock.json"), "utf8"),
			"stub-lock: install left-pad\n",
		);
		assert.equal(
			readFileSync(path.join(ws, "README.md"), "utf8"),
			"unrelated\n",
		);
	} finally {
		process.env.PATH = realPathEnv;
	}
});

test("js_dep_add --dev (STUB npm): exact argv with --save-dev, devDependencies diff", async () => {
	const ws = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-dep-it-")),
	);
	dirs.push(ws);
	const bin = mkdtempSync(path.join(tmpdir(), "pi-nobash-npm-bin-"));
	dirs.push(bin);
	const marker = path.join(bin, "npm-argv.txt");
	const devStub = STUB_NPM_ADD.replace(
		'pkg.dependencies[n] = "1.3.0";',
		'(dev ? (pkg.devDependencies ??= {}) : pkg.dependencies)[n] = "1.3.0";',
	).replace("\tdelete pkg.devDependencies;\n", "");
	writeStubBinary(bin, "npm", devStub, marker);
	writeCompanionConfig(ws);
	writeFileSync(
		path.join(ws, "package.json"),
		'{\n  "name": "fixture",\n  "version": "1.0.0"\n}\n',
	);
	// Unrelated file: the tool must not touch anything but the manifest + lockfile.
	writeFileSync(path.join(ws, "README.md"), "unrelated\n");
	const realPathEnv = process.env.PATH;
	process.env.PATH = `${bin}:${realPathEnv}`;
	try {
		const out = await runTool(registerJsTools, ws, "js_dep_add", {
			packages: ["@scope/pkg"],
			dev: true,
		});
		assert.equal(out.isError, false, out.text);
		assert.equal(
			readFileSync(marker, "utf8"),
			"install\n--ignore-scripts\n--save-dev\n@scope/pkg\n",
		);
		assert.equal(
			readFileSync(path.join(ws, "package.json"), "utf8"),
			'{\n  "name": "fixture",\n  "version": "1.0.0",\n  "dependencies": {},\n  "devDependencies": {\n    "@scope/pkg": "1.3.0"\n  }\n}\n',
		);
		assert.equal(
			readFileSync(path.join(ws, "README.md"), "utf8"),
			"unrelated\n",
		);
	} finally {
		process.env.PATH = realPathEnv;
	}
});

test("js_dep_remove (STUB npm): exact argv, dependency removed from manifest", async () => {
	const ws = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-dep-it-")),
	);
	dirs.push(ws);
	const bin = mkdtempSync(path.join(tmpdir(), "pi-nobash-npm-bin-"));
	dirs.push(bin);
	const marker = path.join(bin, "npm-argv.txt");
	writeStubBinary(bin, "npm", STUB_NPM_ADD, marker);
	writeCompanionConfig(ws);
	writeFileSync(
		path.join(ws, "package.json"),
		'{\n  "name": "fixture",\n  "version": "1.0.0",\n  "dependencies": {\n    "left-pad": "1.3.0",\n    "kept": "2.0.0"\n  }\n}\n',
	);
	const realPathEnv = process.env.PATH;
	process.env.PATH = `${bin}:${realPathEnv}`;
	try {
		const out = await runTool(registerJsTools, ws, "js_dep_remove", {
			packages: ["left-pad"],
		});
		assert.equal(out.isError, false, out.text);
		assert.deepEqual(out.details, {
			packages: ["left-pad"],
			manifestUpdated: true,
		});
		assert.equal(
			readFileSync(marker, "utf8"),
			"uninstall\n--ignore-scripts\nleft-pad\n",
		);
		assert.equal(
			readFileSync(path.join(ws, "package.json"), "utf8"),
			'{\n  "name": "fixture",\n  "version": "1.0.0",\n  "dependencies": {\n    "kept": "2.0.0"\n  }\n}\n',
		);
		assert.equal(
			readFileSync(path.join(ws, "package-lock.json"), "utf8"),
			"stub-lock: uninstall left-pad\n",
		);
	} finally {
		process.env.PATH = realPathEnv;
	}
});

test("expo_dep_add (STUB npx, not real npx): exact argv `npx expo install`, pinned manifest diff", async () => {
	const ws = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-expo-it-")),
	);
	dirs.push(ws);
	const bin = mkdtempSync(path.join(tmpdir(), "pi-nobash-npx-bin-"));
	dirs.push(bin);
	const marker = path.join(bin, "npx-argv.txt");
	// Stub npx: it is invoked as `npx expo install <names…>`, so args[0] is
	// "expo" and the tool must never fall through to plain npm install.
	const expoStub = `
const args = process.argv.slice(2);
if (args[0] !== "expo" || args[1] !== "install") {
	console.error("stub npx: expected 'expo install', got: " + args.join(" "));
	process.exit(1);
}
const pkgPath = process.cwd() + "/package.json";
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.dependencies ??= {};
for (const n of args.slice(2)) pkg.dependencies[n] = "5.0.0";
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\\n");
fs.writeFileSync(process.cwd() + "/package-lock.json", "stub-expo-lock: " + args.slice(2).join(",") + "\\n");
`;
	writeStubBinary(bin, "npx", expoStub, marker);
	writeCompanionConfig(ws);
	writeFileSync(
		path.join(ws, "package.json"),
		'{\n  "name": "expo-fixture",\n  "version": "1.0.0"\n}\n',
	);
	const realPathEnv = process.env.PATH;
	process.env.PATH = `${bin}:${realPathEnv}`;
	try {
		const out = await runTool(registerExpoTools, ws, "expo_dep_add", {
			packages: ["expo-router"],
		});
		assert.equal(out.isError, false, out.text);
		assert.deepEqual(out.details, { packages: ["expo-router"] });
		assert.equal(readFileSync(marker, "utf8"), "expo\ninstall\nexpo-router\n");
		// Version is pinned by the (stub) Expo SDK resolver, not chosen by the model.
		assert.equal(
			readFileSync(path.join(ws, "package.json"), "utf8"),
			'{\n  "name": "expo-fixture",\n  "version": "1.0.0",\n  "dependencies": {\n    "expo-router": "5.0.0"\n  }\n}\n',
		);
		assert.equal(
			readFileSync(path.join(ws, "package-lock.json"), "utf8"),
			"stub-expo-lock: expo-router\n",
		);
	} finally {
		process.env.PATH = realPathEnv;
	}
});

// --- real-binary branches (network/local-binary gated; skip with a printed reason) ---

function findReal(bin: string): string | null {
	try {
		const p = execFileSync("which", [bin], { stdio: "pipe" }).toString().trim();
		return p.length > 0 ? p : null;
	} catch {
		return null;
	}
}

test("js_dep_add (REAL npm): registry probe, then real install of is-number with --ignore-scripts", {
	timeout: 180_000,
}, async (t) => {
	// Probe the registry (bounded 20 s) — NOT a cheap local check: a real
	// install cannot succeed without it.
	try {
		execFileSync("npm", ["ping"], { timeout: 20_000, stdio: "pipe" });
	} catch {
		return t.skip("npm registry unreachable — real-npm branch cannot run here");
	}

	const ws = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-dep-real-")),
	);
	dirs.push(ws);
	writeCompanionConfig(ws);
	writeFileSync(
		path.join(ws, "package.json"),
		'{\n  "name": "real-fixture",\n  "version": "1.0.0",\n  "private": true\n}\n',
	);
	const out = await runTool(registerJsTools, ws, "js_dep_add", {
		packages: ["is-number"],
	});
	assert.equal(out.isError, false, out.text);
	assert.deepEqual(out.details, {
		packages: ["is-number"],
		dev: false,
		manifestUpdated: true,
	});
	const pkg = JSON.parse(
		readFileSync(path.join(ws, "package.json"), "utf8"),
	) as { dependencies?: Record<string, string> };
	assert.ok(pkg.dependencies?.["is-number"], "is-number in package.json");
	assert.ok(existsSync(path.join(ws, "package-lock.json")), "lockfile exists");
});

test("expo_dep_add (REAL expo): exact argv via the real CLI on an SDK project", {
	timeout: 300_000,
}, async (t) => {
	// MUST NOT probe with `npx expo` — that would download expo from the
	// registry just to run a skip check.
	const localExpo =
		findReal("expo") ??
		(existsSync("node_modules/.bin/expo") ? "node_modules/.bin/expo" : null);
	if (!localExpo)
		return t.skip(
			"no local expo binary (node_modules/.bin/expo or PATH) — real-expo branch cannot run here; npx download deliberately not triggered",
		);

	const ws = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-expo-real-")),
	);
	dirs.push(ws);
	writeCompanionConfig(ws);
	writeFileSync(
		path.join(ws, "package.json"),
		'{\n  "name": "real-expo-fixture",\n  "version": "1.0.0",\n  "private": true\n}\n',
	);
	// `expo install` reads the project's installed `expo` module to choose an
	// SDK-compatible version, so bootstrap the SDK first (registry-gated;
	// measured ~9 s / 331 MB). This is what makes the branch a REAL check
	// rather than a stub: on a project without the SDK, expo itself exits 1.
	try {
		execFileSync(
			"npm",
			["install", "--ignore-scripts", "--no-audit", "--no-fund", "expo"],
			{ cwd: ws, timeout: 180_000, stdio: "pipe" },
		);
	} catch {
		return t.skip(
			"could not install the expo SDK module (registry unreachable) — real-expo branch cannot run here",
		);
	}
	const out = await runTool(registerExpoTools, ws, "expo_dep_add", {
		packages: ["expo-constants"],
	});
	assert.equal(out.isError, false, out.text);
	const pkg = JSON.parse(
		readFileSync(path.join(ws, "package.json"), "utf8"),
	) as { dependencies?: Record<string, string> };
	assert.ok(
		pkg.dependencies?.["expo-constants"],
		"expo-constants present in package.json",
	);
});

// --- Python section (P1-6/P1-7): labelled `uv` STUB + real-uv branch ---
// `uv` is NOT on PATH here, so the real-uv branch SKIPS with a printed reason;
// the STUB cases below never claim a real-binary pass.

const STUB_UV = `
const args = process.argv.slice(2);
const op = args[0];
const dev = args.includes("--dev");
const names = args.slice(1).filter((a) => !a.startsWith("-"));
const deps = op === "remove" ? [] : names;
const pinned = deps.map((n) => '"' + n + '==1.3.0"').join(", ");
const project = dev
  ? '[project]\\nname = "fixture"\\nversion = "1.0.0"\\n\\n[dependency-groups]\\ndev = [' + pinned + ']\\n'
  : '[project]\\nname = "fixture"\\nversion = "1.0.0"\\ndependencies = [' + pinned + ']\\n';
fs.writeFileSync(process.cwd() + "/pyproject.toml", project);
fs.writeFileSync(process.cwd() + "/uv.lock", "stub-uv-lock: " + op + " " + names.join(",") + "\\n");
`;

function uvWorkspace(
	fixture: string,
	markerName: string,
): { ws: string; marker: string; realPathEnv: string | undefined } {
	const ws = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-pydep-it-")),
	);
	dirs.push(ws);
	const bin = mkdtempSync(path.join(tmpdir(), "pi-nobash-uv-bin-"));
	dirs.push(bin);
	const marker = path.join(bin, markerName);
	writeStubBinary(bin, "uv", STUB_UV, marker);
	writeCompanionConfig(ws);
	writeFileSync(path.join(ws, "pyproject.toml"), fixture);
	// Unrelated file: the tool must not touch anything but the manifest + lockfile.
	writeFileSync(path.join(ws, "README.md"), "unrelated\n");
	const realPathEnv = process.env.PATH;
	process.env.PATH = `${bin}:${realPathEnv}`;
	return { ws, marker, realPathEnv };
}

const UV_FIXTURE_ADD =
	'[project]\nname = "fixture"\nversion = "1.0.0"\ndependencies = []\n';

test("py_dep_add (STUB uv, not real uv): exact argv, exact pyproject.toml + uv.lock diff", async () => {
	const { ws, marker, realPathEnv } = uvWorkspace(
		UV_FIXTURE_ADD,
		"uv-argv.txt",
	);
	try {
		const out = await runTool(registerPythonTools, ws, "py_dep_add", {
			packages: ["left-pad"],
		});
		assert.equal(out.isError, false, out.text);
		assert.deepEqual(out.details, { packages: ["left-pad"], dev: false });

		// Exact frozen argv, element by element.
		assert.equal(readFileSync(marker, "utf8"), "add\nleft-pad\n");
		// Exact manifest diff written by the (stub) package manager.
		assert.equal(
			readFileSync(path.join(ws, "pyproject.toml"), "utf8"),
			'[project]\nname = "fixture"\nversion = "1.0.0"\ndependencies = ["left-pad==1.3.0"]\n',
		);
		assert.equal(
			readFileSync(path.join(ws, "uv.lock"), "utf8"),
			"stub-uv-lock: add left-pad\n",
		);
		assert.equal(
			readFileSync(path.join(ws, "README.md"), "utf8"),
			"unrelated\n",
		);
	} finally {
		process.env.PATH = realPathEnv;
	}
});

test("py_dep_add --dev (STUB uv): exact argv with --dev, dependency-group diff", async () => {
	const { ws, marker, realPathEnv } = uvWorkspace(
		UV_FIXTURE_ADD,
		"uv-argv-dev.txt",
	);
	try {
		const out = await runTool(registerPythonTools, ws, "py_dep_add", {
			packages: ["Django"],
			dev: true,
		});
		assert.equal(out.isError, false, out.text);
		assert.deepEqual(out.details, { packages: ["Django"], dev: true });
		assert.equal(readFileSync(marker, "utf8"), "add\n--dev\nDjango\n");
		assert.equal(
			readFileSync(path.join(ws, "pyproject.toml"), "utf8"),
			'[project]\nname = "fixture"\nversion = "1.0.0"\n\n[dependency-groups]\ndev = ["Django==1.3.0"]\n',
		);
		assert.equal(
			readFileSync(path.join(ws, "uv.lock"), "utf8"),
			"stub-uv-lock: add Django\n",
		);
	} finally {
		process.env.PATH = realPathEnv;
	}
});

test("py_dep_remove (STUB uv): exact argv, dependency removed from pyproject.toml", async () => {
	const { ws, marker, realPathEnv } = uvWorkspace(
		'[project]\nname = "fixture"\nversion = "1.0.0"\ndependencies = ["left-pad==1.3.0"]\n',
		"uv-argv-remove.txt",
	);
	try {
		const out = await runTool(registerPythonTools, ws, "py_dep_remove", {
			packages: ["left-pad"],
		});
		assert.equal(out.isError, false, out.text);
		assert.deepEqual(out.details, { packages: ["left-pad"] });
		assert.equal(readFileSync(marker, "utf8"), "remove\nleft-pad\n");
		assert.equal(
			readFileSync(path.join(ws, "pyproject.toml"), "utf8"),
			'[project]\nname = "fixture"\nversion = "1.0.0"\ndependencies = []\n',
		);
		assert.equal(
			readFileSync(path.join(ws, "uv.lock"), "utf8"),
			"stub-uv-lock: remove left-pad\n",
		);
	} finally {
		process.env.PATH = realPathEnv;
	}
});

test("py_dep_add (REAL uv): runs only when uv is on PATH, otherwise skips with the reason", {
	timeout: 180_000,
}, async (t) => {
	if (!findReal("uv"))
		return t.skip("uv not on PATH — real-uv branch cannot run here");

	const ws = realpathSync(
		mkdtempSync(path.join(tmpdir(), "pi-nobash-pydep-real-")),
	);
	dirs.push(ws);
	writeCompanionConfig(ws);
	writeFileSync(
		path.join(ws, "pyproject.toml"),
		'[project]\nname = "real-fixture"\nversion = "1.0.0"\nrequires-python = ">=3.11"\ndependencies = []\n',
	);
	const out = await runTool(registerPythonTools, ws, "py_dep_add", {
		packages: ["six"],
	});
	assert.equal(out.isError, false, out.text);
	assert.deepEqual(out.details, { packages: ["six"], dev: false });
	assert.ok(
		readFileSync(path.join(ws, "pyproject.toml"), "utf8").includes("six"),
		"six in pyproject.toml",
	);
	assert.ok(existsSync(path.join(ws, "uv.lock")), "uv.lock exists");
});
