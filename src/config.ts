import { readFileSync } from "node:fs";
import path from "node:path";
import { ToolError } from "./errors.ts";

/** Trusted developer config; the model can never author these values (spec §8). */

export type ValidationTargetsNone = { mode: "none" };
export type ValidationTargetsFile = {
	mode: "file";
	roots: string[];
	extensions?: string[];
	exact?: string[];
	/** Names a verified runner adapter (A7); required for file mode. */
	runner: string;
};
export type ValidationCheck = {
	program: string;
	args: string[];
	cwd: string;
	timeoutMs: number;
	targets: ValidationTargetsNone | ValidationTargetsFile;
};
export type ValidationConfig = {
	validation: { checks: Record<string, ValidationCheck> };
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((s) => typeof s === "string");
}

function parseTargets(
	name: string,
	targets: Record<string, unknown>,
): ValidationCheck["targets"] {
	if (targets.mode === "none") return { mode: "none" };
	if (targets.mode !== "file")
		throw new ToolError(
			"PARSE_ERROR",
			`check "${name}".targets.mode must be "none" or "file"`,
		);
	const { roots, extensions, exact, runner } = targets;
	if (!isStringArray(roots) || roots.length === 0)
		throw new ToolError(
			"PARSE_ERROR",
			`check "${name}".targets.roots must be a non-empty string array`,
		);
	if (extensions !== undefined && !isStringArray(extensions))
		throw new ToolError(
			"PARSE_ERROR",
			`check "${name}".targets.extensions must be a string array`,
		);
	if (exact !== undefined && !isStringArray(exact))
		throw new ToolError(
			"PARSE_ERROR",
			`check "${name}".targets.exact must be a string array`,
		);
	if (typeof runner !== "string" || runner.length === 0)
		throw new ToolError(
			"PARSE_ERROR",
			`check "${name}".targets.runner must be a non-empty string (A7)`,
		);
	return {
		mode: "file",
		roots,
		...(extensions !== undefined ? { extensions } : {}),
		...(exact !== undefined ? { exact } : {}),
		runner,
	};
}

function parseCheck(name: string, raw: unknown): ValidationCheck {
	if (!isRecord(raw))
		throw new ToolError("PARSE_ERROR", `check "${name}" must be an object`);
	const { program, args, cwd, timeoutMs, targets } = raw;
	if (typeof program !== "string" || program.length === 0)
		throw new ToolError(
			"PARSE_ERROR",
			`check "${name}".program must be a non-empty string`,
		);
	if (!isStringArray(args))
		throw new ToolError(
			"PARSE_ERROR",
			`check "${name}".args must be a string array`,
		);
	if (typeof cwd !== "string" || cwd.length === 0)
		throw new ToolError(
			"PARSE_ERROR",
			`check "${name}".cwd must be a non-empty string`,
		);
	if (
		typeof timeoutMs !== "number" ||
		!Number.isFinite(timeoutMs) ||
		timeoutMs <= 0
	)
		throw new ToolError(
			"PARSE_ERROR",
			`check "${name}".timeoutMs must be a positive number`,
		);
	if (!isRecord(targets))
		throw new ToolError(
			"PARSE_ERROR",
			`check "${name}".targets must be an object`,
		);
	return {
		program,
		args,
		cwd,
		timeoutMs,
		targets: parseTargets(name, targets),
	};
}

function parseConfig(raw: unknown): ValidationConfig {
	if (
		!isRecord(raw) ||
		!isRecord(raw.validation) ||
		!isRecord(raw.validation.checks)
	)
		throw new ToolError(
			"PARSE_ERROR",
			"config must be { validation: { checks: {...} } }",
		);
	const extra = Object.keys(raw).filter((k) => k !== "validation");
	if (extra.length > 0)
		throw new ToolError(
			"PARSE_ERROR",
			`unknown top-level config keys: ${extra.join(", ")}`,
		);
	const checks: Record<string, ValidationCheck> = {};
	for (const [name, value] of Object.entries(raw.validation.checks))
		checks[name] = parseCheck(name, value);
	return { validation: { checks } };
}

/**
 * Loads `.pi/pi-nobash.json` under `cwd`. The file is optional; a missing file
 * yields an empty check set. Invalid content is PARSE_ERROR.
 */
export function loadValidationConfig(
	cwd: string = process.cwd(),
): ValidationConfig {
	const file = path.join(cwd, ".pi", "pi-nobash.json");
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return { validation: { checks: {} } };
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
	return parseConfig(raw);
}
