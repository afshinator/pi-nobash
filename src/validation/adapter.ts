import type { ValidationCheck } from "../config.ts";
import { ToolError } from "../errors.ts";

/**
 * Trusted adapter (A7/C5): turns validated target paths into the exact argv
 * suffix appended to check.program + check.args. Never model-supplied.
 */
export type RunnerAdapter = (
	check: ValidationCheck,
	targets: string[],
) => string[];

/** The only verified adapter. `node --test -- <file>` selects exactly that file. */
const nodeTest: RunnerAdapter = (_check, targets) => ["--", ...targets];

const registry: Record<string, RunnerAdapter> = {
	node_test: nodeTest,
};

/**
 * Returns the adapter for a file-mode check, or undefined for none-mode checks.
 * Unknown runners are rejected before process start (INVALID_ARGUMENT).
 */
export function resolveAdapter(
	check: ValidationCheck,
): RunnerAdapter | undefined {
	if (check.targets.mode !== "file") return undefined;
	const adapter = registry[check.targets.runner];
	if (!adapter)
		throw new ToolError(
			"INVALID_ARGUMENT",
			`no verified runner adapter "${check.targets.runner}" for targeted validation; configure targets.mode "none" instead`,
		);
	return adapter;
}
