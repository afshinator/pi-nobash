import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadValidationConfig, type ValidationConfig } from "../config.ts";
import {
	type ErrorCode,
	runTool,
	successResult,
	ToolError,
	type ToolErrorDetails,
} from "../errors.ts";
import type { CheckResult } from "./runner.ts";
import { runCheck } from "./runner.ts";

export const checkResultSchema = Type.Object({
	check: Type.String(),
	targets: Type.Array(Type.String()),
	exitCode: Type.Union([Type.Integer(), Type.Null()]),
	timedOut: Type.Boolean(),
	stdout: Type.String(),
	stderr: Type.String(),
	truncated: Type.Boolean(),
	durationMs: Type.Integer(),
});

function buildSuccess(check: string, result: CheckResult) {
	const notice = result.truncated ? "\n[output truncated]" : "";
	const details = { ...result, check };
	return successResult(
		`check "${check}" exit ${result.exitCode} in ${result.durationMs}ms${notice}\n${result.stdout}${result.stderr}`,
		details,
		details,
	);
}

/**
 * A session-scoped config snapshot taken at registration time, so a later edit
 * to `.pi/pi-nobash.json` cannot change the invoked program/args (F1 hardening).
 */
export type ValidationSnapshot =
	| { config: ValidationConfig }
	| { error: unknown };

function resolveConfig(
	cwd: string,
	snapshot?: ValidationSnapshot,
): ValidationConfig {
	if (!snapshot) return loadValidationConfig(cwd);
	if ("config" in snapshot) return snapshot.config;
	const err = snapshot.error;
	if (
		err instanceof Error &&
		typeof (err as { code?: unknown }).code === "string"
	) {
		const code = (err as unknown as { code: string }).code;
		throw new ToolError(code as ErrorCode, err.message);
	}
	throw err;
}

/**
 * run_validation body: named check only, no command/argv/script surface.
 * Expected failures return the A5 envelope; only unexpected errors throw.
 */
export async function runValidation(
	params: { check: string; targets?: string[] },
	signal: AbortSignal | undefined,
	cwd: string = process.cwd(),
	snapshot?: ValidationSnapshot,
): Promise<AgentToolResult<ToolErrorDetails | CheckResult>> {
	return runTool(async () => {
		const config = resolveConfig(cwd, snapshot);
		const check = config.validation.checks[params.check];
		if (!check)
			throw new ToolError("NOT_FOUND", `unknown check "${params.check}"`);
		const result = await runCheck(check, params.targets ?? [], signal, cwd);
		if (result.timedOut)
			throw new ToolError(
				"TIMEOUT",
				`check "${params.check}" exceeded timeoutMs ${check.timeoutMs}`,
			);
		if (result.exitCode !== 0)
			throw new ToolError(
				"VALIDATION_FAILED",
				`check "${params.check}" failed with exit code ${result.exitCode}`,
			);
		return buildSuccess(params.check, result);
	});
}
