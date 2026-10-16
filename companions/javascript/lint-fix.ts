import { realpathSync } from "node:fs";
import path from "node:path";
import type {
	AgentToolResult,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	runTool,
	successResult,
	ToolError,
	type ToolErrorDetails,
} from "../../src/errors.ts";
import { validateWorkspaceFile } from "../../src/path-policy.ts";
import { JS_LINTERS, type JsLinter } from "../config.ts";
import {
	assertToolPathEntry,
	assertToolPathResolved,
	execFixedChecked,
} from "../process.ts";

/**
 * P1-1 js_lint_fix. Applies SAFE lint fixes to named project files with the
 * developer-configured linter (companions.javascript.linter). The model can
 * never choose a backend, flag, or config path — the schema carries paths
 * only, and the argv comes from the fixed JS_LINTERS table. Non-zero exit is
 * NOT a failure: `check --write` exits 1 when diagnostics remain after the
 * safe fixes, which surfaces as remainingIssues, not an error.
 */
const MAX_LINT_PATHS = 50;

/** Fixed per-backend handled-extension sets (F3). */
const EXTENSIONS: Record<JsLinter, ReadonlySet<string>> = {
	biome: new Set([
		".js",
		".jsx",
		".ts",
		".tsx",
		".mjs",
		".cjs",
		".mts",
		".cts",
		".json",
		".jsonc",
		".css",
	]),
	eslint: new Set([
		".js",
		".jsx",
		".ts",
		".tsx",
		".mjs",
		".cjs",
		".mts",
		".cts",
	]),
};

const TIMEOUT_MS = 120_000;

const lintFixDetailsSchema = Type.Object({
	fixed: Type.Array(Type.String()),
	remainingIssues: Type.Boolean(),
	truncated: Type.Boolean(),
});

const parameters = Type.Object({
	paths: Type.Array(Type.String(), {
		minItems: 1,
		maxItems: MAX_LINT_PATHS,
		description: "Project files to lint-fix (workspace-relative)",
	}),
});

export type LintFixDetails = {
	fixed: string[];
	remainingIssues: boolean;
	truncated: boolean;
};

type ToolBody<T> = AgentToolResult<T | ToolErrorDetails>;

async function lintFixImpl(
	params: { paths: string[] },
	signal: AbortSignal | undefined,
	cwd: string,
	linter: JsLinter,
	timeoutMs: number = TIMEOUT_MS,
): Promise<ToolBody<LintFixDetails>> {
	return runTool(async () => {
		if (params.paths.length > MAX_LINT_PATHS)
			throw new ToolError(
				"LIMIT_EXCEEDED",
				`too many paths (max ${MAX_LINT_PATHS})`,
			);
		const allowed = EXTENSIONS[linter];
		const realCwd = realpathSync(cwd);
		const resolved = params.paths.map((p) => {
			assertToolPathEntry(p, "lint-fixable");
			const ext = path.extname(p);
			if (!allowed.has(ext))
				throw new ToolError(
					"INVALID_ARGUMENT",
					`${linter} does not lint ${ext || "files without extension"}: ${p}`,
				);
			const abs = validateWorkspaceFile(cwd, p);
			assertToolPathResolved(realCwd, abs, p, "lint-fixable");
			return abs;
		});
		const invocation = JS_LINTERS[linter];
		const outcome = await execFixedChecked(
			invocation.program,
			[...invocation.args, ...resolved],
			cwd,
			{ timeoutMs, signal, failOnExit: false },
			`${linter} lint-fix`,
		);
		// Non-zero exit means diagnostics REMAIN after the safe fixes (F4),
		// not that the tool failed.
		// shortcut: details.fixed echoes the input paths, not linter output, upgrade when per-file fix detail is needed
		return successResult(
			outcome.code === 0
				? `lint-fixed ${resolved.length} file(s)`
				: `lint-fixed ${resolved.length} file(s); diagnostics remain`,
			{
				fixed: [...params.paths],
				remainingIssues: outcome.code !== 0,
				truncated: outcome.truncated,
			},
		);
	});
}

/** Direct-caller body (tests, the registrar); linter passed explicitly. */
export function jsLintFix(
	params: { paths: string[] },
	signal: AbortSignal | undefined,
	cwd: string,
	linter: JsLinter,
	timeoutMs?: number,
): Promise<ToolBody<LintFixDetails>> {
	return lintFixImpl(params, signal, cwd, linter, timeoutMs);
}

export const jsLintFixTool: ToolDefinition<
	typeof parameters,
	LintFixDetails | ToolErrorDetails
> = {
	name: "js_lint_fix",
	label: "Lint-fix JS/TS files",
	description:
		"Apply safe lint fixes to named project files with the developer-configured linter (Biome or ESLint from .pi/pi-nobash-companions.json). Fixed argv; no backend, flag, or config field.",
	promptSnippet:
		"Apply safe lint fixes to named project files (developer-configured Biome/ESLint).",
	annotations: { readOnlyHint: false },
	parameters,
	outputSchema: lintFixDetailsSchema,
	exposure: "direct",
	defaultActive: false,
	execute: (_toolCallId, params, signal) =>
		jsLintFix(params, signal, process.cwd(), "biome"),
};
