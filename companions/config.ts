import fs, { realpathSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ToolError } from "../src/errors.ts";

/**
 * FD5: companion backends are developer project config, read once per session.
 * Values are enumerated names only; trusted code maps each name to a fixed
 * { program, args } via the builder tables below. Config never supplies a
 * program, executable path, or argv.
 */

export type JsFormatter = "prettier" | "biome";
export type JsLinter = "biome" | "eslint";

export type FixedInvocation = { program: string; args: string[] };

export const JS_FORMATTERS: Record<JsFormatter, FixedInvocation> = {
	prettier: { program: "npx", args: ["prettier", "--write", "--"] },
	biome: { program: "npx", args: ["biome", "format", "--write", "--"] },
};
export const PY_FORMATTERS = {
	ruff: { program: "ruff", args: ["format", "--"] },
} as const;

/**
 * FD6 dependency-tool builders: fixed argv per (manager, operation); the tool
 * appends only grammar-validated bare package names. `--ignore-scripts` is
 * frozen (P1-3): npm install lifecycle scripts are arbitrary execution, so
 * the flag is unconditional — the model can never remove it.
 */
export type DepCommands = {
	add: FixedInvocation;
	addDev?: FixedInvocation;
	remove: FixedInvocation;
};
export const JS_PACKAGE_MANAGERS: Record<string, DepCommands> = {
	npm: {
		add: { program: "npm", args: ["install", "--ignore-scripts"] },
		addDev: {
			program: "npm",
			args: ["install", "--ignore-scripts", "--save-dev"],
		},
		remove: { program: "npm", args: ["uninstall", "--ignore-scripts"] },
	},
};
export const PY_PACKAGE_MANAGERS: Record<string, DepCommands> = {
	uv: {
		add: { program: "uv", args: ["add"] },
		addDev: { program: "uv", args: ["add", "--dev"] },
		remove: { program: "uv", args: ["remove"] },
	},
};

export const JS_LINTERS: Record<JsLinter, FixedInvocation> = {
	biome: { program: "npx", args: ["biome", "check", "--write", "--"] },
	eslint: { program: "npx", args: ["eslint", "--fix", "--"] },
};
export const PY_LINTERS = {
	ruff: { program: "ruff", args: ["check", "--fix", "--"] },
} as const;

export type CompanionConfig = {
	javascript: {
		formatter: JsFormatter;
		linter: JsLinter;
		packageManager: "npm";
	};
	python: {
		formatter: "ruff";
		linter: "ruff";
		packageManager: "uv";
	};
};

const DEFAULTS: CompanionConfig = {
	javascript: { formatter: "prettier", linter: "biome", packageManager: "npm" },
	python: { formatter: "ruff", linter: "ruff", packageManager: "uv" },
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseStack(
	name: string,
	raw: unknown,
	defaults: { formatter: string; linter: string; packageManager: string },
): { formatter: string; linter: string; packageManager: string } {
	if (!isRecord(raw))
		throw new ToolError("PARSE_ERROR", `companions.${name} must be an object`);
	const extra = Object.keys(raw).filter(
		(k) => !["formatter", "linter", "packageManager"].includes(k),
	);
	if (extra.length > 0)
		throw new ToolError(
			"PARSE_ERROR",
			`unknown companions.${name} keys: ${extra.join(", ")}`,
		);
	// FD5: every key is optional; a missing key falls back to its default.
	return {
		formatter: (raw.formatter as string | undefined) ?? defaults.formatter,
		linter: (raw.linter as string | undefined) ?? defaults.linter,
		packageManager:
			(raw.packageManager as string | undefined) ?? defaults.packageManager,
	};
}

function parseCompanionConfig(raw: unknown): CompanionConfig {
	if (!isRecord(raw))
		throw new ToolError("PARSE_ERROR", "config must be a JSON object");
	const extra = Object.keys(raw).filter((k) => k !== "companions");
	if (extra.length > 0)
		throw new ToolError(
			"PARSE_ERROR",
			`unknown top-level config keys: ${extra.join(", ")}`,
		);
	const companions = raw.companions;
	if (companions === undefined)
		throw new ToolError(
			"PARSE_ERROR",
			"config must contain a companions object",
		);
	if (!isRecord(companions))
		throw new ToolError("PARSE_ERROR", "companions must be an object");
	const extraStacks = Object.keys(companions).filter(
		(k) => !["javascript", "python"].includes(k),
	);
	if (extraStacks.length > 0)
		throw new ToolError(
			"PARSE_ERROR",
			`unknown companion stacks: ${extraStacks.join(", ")}`,
		);
	const js = parseStack(
		"javascript",
		companions.javascript ?? {},
		DEFAULTS.javascript,
	);
	const py = parseStack("python", companions.python ?? {}, DEFAULTS.python);
	return {
		javascript: {
			formatter: parseEnum("javascript.formatter", js.formatter, [
				"prettier",
				"biome",
			]) as JsFormatter,
			linter: parseEnum("javascript.linter", js.linter, [
				"biome",
				"eslint",
			]) as JsLinter,
			packageManager: parseEnum(
				"javascript.packageManager",
				js.packageManager,
				["npm"],
			) as "npm",
		},
		python: {
			formatter: parseEnum("python.formatter", py.formatter, [
				"ruff",
			]) as "ruff",
			linter: parseEnum("python.linter", py.linter, ["ruff"]) as "ruff",
			packageManager: parseEnum("python.packageManager", py.packageManager, [
				"uv",
			]) as "uv",
		},
	};
}

function parseEnum(
	field: string,
	value: unknown,
	allowed: readonly string[],
): string {
	if (typeof value !== "string" || !allowed.includes(value))
		throw new ToolError(
			"PARSE_ERROR",
			`companions.${field} must be one of: ${allowed.join(", ")}`,
		);
	return value;
}

/**
 * Loads `.pi/pi-nobash-companions.json` under `dir` (FD5). Missing file ->
 * defaults; malformed JSON, unknown key, or non-enum value -> PARSE_ERROR.
 * Never reads `.pi/pi-nobash.json` (PD7).
 */
export function loadCompanionConfig(dir: string): CompanionConfig {
	const file = path.join(dir, ".pi", "pi-nobash-companions.json");
	let text: string;
	try {
		// Default-import property access (like companions/process.ts documents for
		// spawn) so tests can intercept and count reads.
		text = fs.readFileSync(file, "utf8");
	} catch {
		return {
			javascript: { ...DEFAULTS.javascript },
			python: { ...DEFAULTS.python },
		};
	}
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		throw new ToolError(
			"PARSE_ERROR",
			`invalid JSON in ${file}: ${(e as Error).message}`,
		);
	}
	return parseCompanionConfig(raw);
}

/** Same directory may arrive as /var/... vs /private/var/... (macOS) or via symlink. */
function normalizeCwd(dir: string): string {
	try {
		return realpathSync(dir);
	} catch {
		return dir;
	}
}

export type ToolCtx = {
	cwd: string;
	sessionManager: { getSessionId(): string };
};

/**
 * A10 pattern (mirrors src/validation/index.ts): the snapshot is read once when
 * the session starts, for the SESSION cwd. The registration-cwd snapshot is
 * only a fallback for direct/unit callers. A ctx.cwd other than the bound
 * session cwd is rejected rather than lazily loading that directory's config.
 * Returns a getter tools call from execute() with the tool-call ctx.
 */
export function bindCompanionConfig(
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): (ctx: ToolCtx) => CompanionConfig {
	// Direct-caller fallback snapshot: lazy (no read at bind time), per-binder.
	let fallback: Snapshot | undefined;
	pi.on("session_start", (_event, ctx) => {
		const id = ctx.sessionManager.getSessionId();
		// One read per session id at its session_start: the first binder's
		// handler performs the read; other binders for the SAME id reuse it.
		// session_shutdown deletes, so a later session id reads again.
		if (!SESSION_SNAPSHOTS.has(id))
			SESSION_SNAPSHOTS.set(id, {
				cwd: normalizeCwd(ctx.cwd),
				snapshot: readSnapshot(ctx.cwd),
			});
	});
	pi.on("session_shutdown", (_event, ctx) => {
		SESSION_SNAPSHOTS.delete(ctx.sessionManager.getSessionId());
	});
	return (ctx: ToolCtx): CompanionConfig => {
		const bound = SESSION_SNAPSHOTS.get(ctx.sessionManager.getSessionId());
		const ok = normalizeCwd(ctx.cwd) === (bound?.cwd ?? normalizeCwd(cwd));
		if (!ok)
			throw new ToolError(
				"INVALID_ARGUMENT",
				"no companion config loaded for this workspace",
			);
		// Direct-caller fallback: lazy, per-binder, read once on first use.
		let snapshot = bound?.snapshot;
		if (snapshot === undefined) {
			fallback ??= readSnapshot(cwd);
			snapshot = fallback;
		}
		if ("error" in snapshot) throw snapshot.error;
		return snapshot.config;
	};
}

type Snapshot = { config: CompanionConfig } | { error: ToolError };

/** Session-id keyed snapshot cache shared by every bindCompanionConfig call. */
const SESSION_SNAPSHOTS = new Map<
	string,
	{ cwd: string; snapshot: Snapshot }
>();

function readSnapshot(dir: string): Snapshot {
	try {
		return { config: loadCompanionConfig(dir) };
	} catch (error) {
		return { error: error as ToolError };
	}
}
