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
import { execFixed } from "../process.ts";
import {
	assertNpmPackageName,
	MAX_DEP_PACKAGES,
} from "../javascript/dep.ts";

/**
 * P1-5 expo_dep_add. Installs Expo packages via `npx expo install`, whose
 * resolver pins SDK-compatible versions. NEVER plain `npm install` — a plain
 * install takes latest and can break the Expo SDK matrix. Lifecycle scripts
 * may run here (Expo-blessed path; documented) — the reason this is its own
 * tool rather than a flag on js_dep_add. Shares the npm name grammar
 * (assertNpmPackageName) with the JS dep tools — one grammar, one suite.
 */

const TIMEOUT_MS = 600_000;

// Fixed invocation; no model-supplied flags, no npm fallback. Deliberately
// NOT a config.ts table entry: `expo` is not a packageManager enum value, so
// a table entry would imply config selection that does not exist.
const EXPO_INSTALL = { program: "npx", args: ["expo", "install"] } as const;

type ToolBody<T> = AgentToolResult<T | ToolErrorDetails>;

export type ExpoDepAddDetails = { packages: string[] };

async function expoDepAddImpl(
	params: { packages: string[] },
	signal: AbortSignal | undefined,
	cwd: string,
	timeoutMs: number,
): Promise<ToolBody<ExpoDepAddDetails>> {
	return runTool(async () => {
		if (params.packages.length > MAX_DEP_PACKAGES)
			throw new ToolError(
				"LIMIT_EXCEEDED",
				`too many packages (max ${MAX_DEP_PACKAGES}); add in batches`,
			);
		const packages = params.packages.map(assertNpmPackageName);
		const outcome = await execFixed(
			EXPO_INSTALL.program,
			[...EXPO_INSTALL.args, ...packages],
			cwd,
			{ timeoutMs, signal },
		);
		if (outcome.timedOut)
			throw new ToolError(
				"TIMEOUT",
				`expo install timed out after ${timeoutMs} ms`,
			);
		if (outcome.code !== 0)
			throw new ToolError(
				"VALIDATION_FAILED",
				`expo install failed (exit ${outcome.code}): ${outcome.stderr || outcome.stdout}`,
			);
		return successResult(
			`added ${packages.length} package${packages.length === 1 ? "" : "s"}`,
			{ packages },
		);
	});
}

/** Direct-caller body (tests, the registrar). */
export function expoDepAdd(
	params: { packages: string[] },
	signal: AbortSignal | undefined,
	cwd: string,
	timeoutMs: number = TIMEOUT_MS,
): Promise<ToolBody<ExpoDepAddDetails>> {
	return expoDepAddImpl(params, signal, cwd, timeoutMs);
}

export const expoDepAddParameters = Type.Object({
	packages: Type.Array(Type.String(), {
		minItems: 1,
		maxItems: MAX_DEP_PACKAGES,
		description:
			"npm package names (no version, range, URL, git specifier, or alias)",
	}),
});

export const expoDepAddDetailsSchema = Type.Object({
	packages: Type.Array(Type.String()),
});

export const expoDepAddTool: ToolDefinition<
	typeof expoDepAddParameters,
	ExpoDepAddDetails | ToolErrorDetails
> = {
	name: "expo_dep_add",
	label: "Add Expo dependencies",
	description:
		"Install Expo packages via `npx expo install` so SDK-compatible versions are pinned by Expo's resolver — never plain npm install. Rewrites package.json and the lockfile; needs network.",
	promptSnippet:
		"Add Expo dependencies with SDK-pinned versions via expo install.",
	annotations: { readOnlyHint: false, destructiveHint: true },
	parameters: expoDepAddParameters,
	outputSchema: expoDepAddDetailsSchema,
	exposure: "direct",
	defaultActive: false,
	execute: (_toolCallId, params, signal) =>
		expoDepAdd(params, signal, process.cwd()),
};
