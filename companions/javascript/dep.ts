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
import { JS_PACKAGE_MANAGERS } from "../config.ts";
import { execFixed } from "../process.ts";

/**
 * P1-3/P1-4 js_dep_add / js_dep_remove. Installs/uninstalls BARE npm package
 * names with the developer-configured package manager
 * (companions.javascript.packageManager). The model can never choose a
 * version, tag, URL, git source, alias, or flag: the name grammar rejects
 * them all, and argv comes from the frozen JS_PACKAGE_MANAGERS table with
 * --ignore-scripts unconditional (P1-3).
 */

export const MAX_DEP_PACKAGES = 20;
const TIMEOUT_MS = 300_000;

type ToolBody<T> = AgentToolResult<T | ToolErrorDetails>;

// npm name grammar (F5), checked piecewise so each rejection reason is exact:
// @scope/name or bare name, charset [a-z0-9._-], no leading '.'/'-' per
// segment, <= 214 chars. A non-leading '@' is how versions, ranges, tags and
// aliases arrive; a leading '-' is option injection (names are bare argv
// elements, there is no `--` separator).
const SCOPED = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const BARE = /^[a-z0-9][a-z0-9._-]*$/;

/** Rejects anything that is not a bare npm name; returns the name unchanged. */
export function assertNpmPackageName(name: string): string {
	const bad = (why: string): never => {
		throw new ToolError(
			"INVALID_ARGUMENT",
			`not a bare npm package name (no version, range, tag, URL, git source, alias, or uppercase allowed): ${JSON.stringify(name)} — ${why}`,
		);
	};
	if (typeof name !== "string" || name.length === 0) bad("empty");
	if (name.length > 214) bad("longer than 214 chars");
	if (/\s/.test(name)) bad("contains whitespace");
	if (name.includes(":")) bad("contains ':'");
	if (name.slice(1).includes("@"))
		bad("'@' is only allowed as the leading scope marker");
	if (!SCOPED.test(name) && !BARE.test(name))
		bad("not @scope/name or a lowercase bare name");
	return name;
}

/** Validates a whole packages list: LIMIT_EXCEEDED first, then each name. */
export function validateDepPackages(packages: string[]): string[] {
	if (packages.length > MAX_DEP_PACKAGES)
		throw new ToolError(
			"LIMIT_EXCEEDED",
			`too many packages (max ${MAX_DEP_PACKAGES}); add in batches`,
		);
	return packages.map(assertNpmPackageName);
}

/**
 * F6 table lookup: an unknown manager, or an entry lacking the requested
 * verb, fails loudly (CAPABILITY_GAP) before any spawn — reachable when FD6
 * widens the packageManager enum without adding a builder.
 */
function lookupManager(
	manager: string,
	verb: "add" | "addDev" | "remove",
): { program: string; args: string[] } {
	const entry = JS_PACKAGE_MANAGERS[manager];
	if (entry === undefined)
		throw new ToolError(
			"CAPABILITY_GAP",
			`javascript package manager "${manager}" has no dependency builder`,
			"package_manager",
		);
	const cmd = entry[verb];
	if (cmd === undefined)
		throw new ToolError(
			"CAPABILITY_GAP",
			`javascript package manager "${manager}" does not support "${verb}"`,
			"package_manager",
		);
	return cmd;
}

export type JsDepAddDetails = {
	packages: string[];
	dev: boolean;
	manifestUpdated: true;
};
export type JsDepRemoveDetails = {
	packages: string[];
	manifestUpdated: true;
};

async function depAddImpl(
	params: { packages: string[]; dev?: boolean },
	signal: AbortSignal | undefined,
	cwd: string,
	manager: string,
	timeoutMs: number,
): Promise<ToolBody<JsDepAddDetails>> {
	return runTool(async () => {
		const packages = validateDepPackages(params.packages);
		const dev = params.dev === true;
		const cmd = lookupManager(manager, dev ? "addDev" : "add");
		const outcome = await execFixed(
			cmd.program,
			[...cmd.args, ...packages],
			cwd,
			{ timeoutMs, signal },
		);
		if (outcome.timedOut)
			throw new ToolError(
				"TIMEOUT",
				`npm install timed out after ${timeoutMs} ms`,
			);
		if (outcome.code !== 0)
			throw new ToolError(
				"VALIDATION_FAILED",
				`npm install failed (exit ${outcome.code}): ${outcome.stderr || outcome.stdout}`,
			);
		return successResult(
			`added ${packages.length} package${packages.length === 1 ? "" : "s"}${dev ? " (dev)" : ""}`,
			{ packages, dev, manifestUpdated: true },
		);
	});
}

async function depRemoveImpl(
	params: { packages: string[] },
	signal: AbortSignal | undefined,
	cwd: string,
	manager: string,
	timeoutMs: number,
): Promise<ToolBody<JsDepRemoveDetails>> {
	return runTool(async () => {
		const packages = validateDepPackages(params.packages);
		const cmd = lookupManager(manager, "remove");
		const outcome = await execFixed(
			cmd.program,
			[...cmd.args, ...packages],
			cwd,
			{ timeoutMs, signal },
		);
		if (outcome.timedOut)
			throw new ToolError(
				"TIMEOUT",
				`npm uninstall timed out after ${timeoutMs} ms`,
			);
		if (outcome.code !== 0)
			throw new ToolError(
				"VALIDATION_FAILED",
				`npm uninstall failed (exit ${outcome.code}): ${outcome.stderr || outcome.stdout}`,
			);
		return successResult(
			`removed ${packages.length} package${packages.length === 1 ? "" : "s"}`,
			{
				packages,
				manifestUpdated: true,
			},
		);
	});
}

/** Direct-caller body (tests, the registrar); manager passed explicitly. */
export function jsDepAdd(
	params: { packages: string[]; dev?: boolean },
	signal: AbortSignal | undefined,
	cwd: string,
	manager: string = "npm",
	timeoutMs: number = TIMEOUT_MS,
): Promise<ToolBody<JsDepAddDetails>> {
	return depAddImpl(params, signal, cwd, manager, timeoutMs);
}

export function jsDepRemove(
	params: { packages: string[] },
	signal: AbortSignal | undefined,
	cwd: string,
	manager: string = "npm",
	timeoutMs: number = TIMEOUT_MS,
): Promise<ToolBody<JsDepRemoveDetails>> {
	return depRemoveImpl(params, signal, cwd, manager, timeoutMs);
}

const depPackages = Type.Array(Type.String(), {
	minItems: 1,
	maxItems: MAX_DEP_PACKAGES,
	description:
		"npm package names (no version, range, URL, git specifier, or alias)",
});

export const depAddParameters = Type.Object({
	packages: depPackages,
	dev: Type.Optional(
		Type.Boolean({
			default: false,
			description: "Save as a devDependency",
		}),
	),
});
export const depRemoveParameters = Type.Object({ packages: depPackages });

export const jsDepAddDetailsSchema = Type.Object({
	packages: Type.Array(Type.String()),
	dev: Type.Boolean(),
	manifestUpdated: Type.Literal(true),
});
export const jsDepRemoveDetailsSchema = Type.Object({
	packages: Type.Array(Type.String()),
	manifestUpdated: Type.Literal(true),
});

export const jsDepAddTool: ToolDefinition<
	typeof depAddParameters,
	JsDepAddDetails | ToolErrorDetails
> = {
	name: "js_dep_add",
	label: "Add npm dependencies",
	description:
		"Install bare npm package names with the developer-configured package manager. Lifecycle scripts are always disabled (--ignore-scripts) and versions are resolved by the project's registry — the model cannot pin versions or pass flags. Rewrites package.json and the lockfile; needs network.",
	promptSnippet:
		"Add npm dependencies by bare name (install scripts disabled, version not choosable).",
	annotations: { readOnlyHint: false, destructiveHint: true },
	parameters: depAddParameters,
	outputSchema: jsDepAddDetailsSchema,
	exposure: "direct",
	defaultActive: false,
	execute: (_toolCallId, params, signal) =>
		jsDepAdd(params, signal, process.cwd()),
};

export const jsDepRemoveTool: ToolDefinition<
	typeof depRemoveParameters,
	JsDepRemoveDetails | ToolErrorDetails
> = {
	name: "js_dep_remove",
	label: "Remove npm dependencies",
	description:
		"Uninstall bare npm package names with the developer-configured package manager. Fixed argv; no flags. Rewrites package.json and the lockfile.",
	promptSnippet: "Remove npm dependencies by bare name (no flags).",
	annotations: { readOnlyHint: false, destructiveHint: true },
	parameters: depRemoveParameters,
	outputSchema: jsDepRemoveDetailsSchema,
	exposure: "direct",
	defaultActive: false,
	execute: (_toolCallId, params, signal) =>
		jsDepRemove(params, signal, process.cwd()),
};
