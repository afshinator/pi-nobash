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
import { PY_LINTERS } from "../config.ts";
import {
	assertToolPathEntry,
	assertToolPathResolved,
	execFixedChecked,
} from "../process.ts";

/**
 * P1-2 py_lint_fix. Applies safe lint fixes to named Python files with Ruff
 * (the only python.linter enum member). The model can never choose a flag or
 * config path — the schema carries paths only, and the argv comes from the
 * fixed PY_LINTERS table. Non-zero exit is NOT a failure: `ruff check --fix`
 * exits 1 when diagnostics remain after the fixes (F4).
 */
const MAX_LINT_PATHS = 50;

const EXTENSIONS = new Set([".py", ".pyi"]);

const TIMEOUT_MS = 60_000;

const lintFixDetailsSchema = Type.Object({
	fixed: Type.Array(Type.String()),
	remainingIssues: Type.Boolean(),
	truncated: Type.Boolean(),
});

const parameters = Type.Object({
	paths: Type.Array(Type.String(), {
		minItems: 1,
		maxItems: MAX_LINT_PATHS,
		description: "Python files to lint-fix (workspace-relative)",
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
	linter: "ruff" = "ruff",
	timeoutMs: number = TIMEOUT_MS,
): Promise<ToolBody<LintFixDetails>> {
	return runTool(async () => {
		if (params.paths.length > MAX_LINT_PATHS)
			throw new ToolError(
				"LIMIT_EXCEEDED",
				`too many paths (max ${MAX_LINT_PATHS})`,
			);
		const realCwd = realpathSync(cwd);
		const resolved = params.paths.map((p) => {
			assertToolPathEntry(p, "lint-fixable");
			const ext = path.extname(p);
			if (!EXTENSIONS.has(ext))
				throw new ToolError(
					"INVALID_ARGUMENT",
					`ruff lint-fix only handles .py/.pyi: ${p}`,
				);
			const abs = validateWorkspaceFile(cwd, p);
			assertToolPathResolved(realCwd, abs, p, "lint-fixable");
			return abs;
		});
		const invocation = PY_LINTERS[linter];
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

/** Direct-caller body (tests, the registrar); linter passed through the enum table. */
export function pyLintFix(
	params: { paths: string[] },
	signal: AbortSignal | undefined,
	cwd: string,
	linter?: "ruff",
	timeoutMs?: number,
): Promise<ToolBody<LintFixDetails>> {
	return lintFixImpl(params, signal, cwd, linter, timeoutMs);
}

export const pyLintFixTool: ToolDefinition<
	typeof parameters,
	LintFixDetails | ToolErrorDetails
> = {
	name: "py_lint_fix",
	label: "Lint-fix Python files",
	description:
		"Apply safe lint fixes to named Python files with Ruff (developer-configured, from .pi/pi-nobash-companions.json). Fixed argv; no backend, flag, or config field.",
	promptSnippet:
		"Apply safe lint fixes to named Python files (Ruff, developer-configured).",
	annotations: { readOnlyHint: false },
	parameters,
	outputSchema: lintFixDetailsSchema,
	exposure: "direct",
	defaultActive: false,
	execute: (_toolCallId, params, signal) =>
		pyLintFix(params, signal, process.cwd()),
};
