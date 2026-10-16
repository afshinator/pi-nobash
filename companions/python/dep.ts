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
import { PY_PACKAGE_MANAGERS } from "../config.ts";
import { execFixedChecked } from "../process.ts";

/**
 * P1-6/P1-7 py_dep_add / py_dep_remove. Adds/removes BARE PEP 508 package
 * names with the developer-configured package manager
 * (companions.python.packageManager). The model can never choose a version,
 * specifier, extra, marker, URL, VCS link, or flag: the name grammar rejects
 * them all, and argv comes from the frozen PY_PACKAGE_MANAGERS table.
 * Documented effects: PyPI fetch, pyproject.toml + uv.lock rewrite, and a
 * .venv update. uv runs the dependency's BUILD backend under build isolation;
 * it does not run the dependency's install-time scripts.
 */

export const MAX_DEP_PACKAGES = 20;
const TIMEOUT_MS = 300_000;

type ToolBody<T> = AgentToolResult<T | ToolErrorDetails>;

/**
 * PEP 508 name grammar (F5): alphanumeric first char, then [A-Za-z0-9._-].
 * Uppercase is valid for Python (Django, PyYAML) — unlike npm. The
 * alphanumeric first character is the F5-DIVERGENCE from A3's
 * `[A-Za-z0-9._-]+`: names are appended as bare argv elements with no `--`
 * separator, so a leading `-` would be option injection, and a leading `.` or
 * `_` is not a PyPI name.
 */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Rejects anything that is not a bare PEP 508 name; returns it unchanged. */
function assertPyPackageName(name: string): string {
	const bad = (why: string): never => {
		throw new ToolError(
			"INVALID_ARGUMENT",
			`not a bare PEP 508 package name (no version, specifier, extra, marker, URL, or VCS link allowed): ${JSON.stringify(name)} — ${why}`,
		);
	};
	if (typeof name !== "string" || name.length === 0) bad("empty");
	if (/\s/.test(name)) bad("contains whitespace");
	if (!NAME.test(name)) bad("not [A-Za-z0-9][A-Za-z0-9._-]*");
	return name;
}

/** Validates a whole packages list: LIMIT_EXCEEDED first, then each name. */
function validatePyDepPackages(packages: string[]): string[] {
	if (packages.length > MAX_DEP_PACKAGES)
		throw new ToolError(
			"LIMIT_EXCEEDED",
			`too many packages (max ${MAX_DEP_PACKAGES}); add in batches`,
		);
	return packages.map(assertPyPackageName);
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
	const entry = PY_PACKAGE_MANAGERS[manager];
	if (entry === undefined)
		throw new ToolError(
			"CAPABILITY_GAP",
			`python package manager "${manager}" has no dependency builder`,
			"package_manager",
		);
	const cmd = entry[verb];
	if (cmd === undefined)
		throw new ToolError(
			"CAPABILITY_GAP",
			`python package manager "${manager}" does not support "${verb}"`,
			"package_manager",
		);
	return cmd;
}

export type PyDepAddDetails = { packages: string[]; dev: boolean };
export type PyDepRemoveDetails = { packages: string[] };

async function depAddImpl(
	params: { packages: string[]; dev?: boolean },
	signal: AbortSignal | undefined,
	cwd: string,
	manager: string,
	timeoutMs: number,
): Promise<ToolBody<PyDepAddDetails>> {
	return runTool(async () => {
		const packages = validatePyDepPackages(params.packages);
		const dev = params.dev === true;
		const cmd = lookupManager(manager, dev ? "addDev" : "add");
		const label = [cmd.program, ...cmd.args].join(" ");
		await execFixedChecked(
			cmd.program,
			[...cmd.args, ...packages],
			cwd,
			{ timeoutMs, signal },
			label,
		);
		return successResult(
			`added ${packages.length} package${packages.length === 1 ? "" : "s"}${dev ? " (dev)" : ""}`,
			{ packages, dev },
		);
	});
}

async function depRemoveImpl(
	params: { packages: string[] },
	signal: AbortSignal | undefined,
	cwd: string,
	manager: string,
	timeoutMs: number,
): Promise<ToolBody<PyDepRemoveDetails>> {
	return runTool(async () => {
		const packages = validatePyDepPackages(params.packages);
		const cmd = lookupManager(manager, "remove");
		const label = [cmd.program, ...cmd.args].join(" ");
		await execFixedChecked(
			cmd.program,
			[...cmd.args, ...packages],
			cwd,
			{ timeoutMs, signal },
			label,
		);
		return successResult(
			`removed ${packages.length} package${packages.length === 1 ? "" : "s"}`,
			{ packages },
		);
	});
}

/** Direct-caller body (tests, the registrar); manager passed explicitly. */
export function pyDepAdd(
	params: { packages: string[]; dev?: boolean },
	signal: AbortSignal | undefined,
	cwd: string,
	manager: string = "uv",
	timeoutMs: number = TIMEOUT_MS,
): Promise<ToolBody<PyDepAddDetails>> {
	return depAddImpl(params, signal, cwd, manager, timeoutMs);
}

export function pyDepRemove(
	params: { packages: string[] },
	signal: AbortSignal | undefined,
	cwd: string,
	manager: string = "uv",
	timeoutMs: number = TIMEOUT_MS,
): Promise<ToolBody<PyDepRemoveDetails>> {
	return depRemoveImpl(params, signal, cwd, manager, timeoutMs);
}

const depPackages = Type.Array(Type.String(), {
	minItems: 1,
	maxItems: MAX_DEP_PACKAGES,
	description: "PyPI package names (no extras, specifier, URL, or VCS link)",
});

const pyDepAddParameters = Type.Object({
	packages: depPackages,
	dev: Type.Optional(Type.Boolean({ description: "Add as a dev dependency" })),
});
const pyDepRemoveParameters = Type.Object({ packages: depPackages });

const pyDepAddDetailsSchema = Type.Object({
	packages: Type.Array(Type.String()),
	dev: Type.Boolean(),
});
const pyDepRemoveDetailsSchema = Type.Object({
	packages: Type.Array(Type.String()),
});

export const pyDepAddTool: ToolDefinition<
	typeof pyDepAddParameters,
	PyDepAddDetails | ToolErrorDetails
> = {
	name: "py_dep_add",
	label: "Add Python dependencies",
	description:
		"Add bare PyPI package names with the developer-configured package manager. The version is resolved by uv — the model cannot pin, extend, or pass flags. Rewrites pyproject.toml and uv.lock and updates the venv; needs network.",
	promptSnippet:
		"Add Python dependencies by bare name (no version, extras, or flags).",
	annotations: { readOnlyHint: false, destructiveHint: true },
	parameters: pyDepAddParameters,
	outputSchema: pyDepAddDetailsSchema,
	exposure: "direct",
	defaultActive: false,
	execute: (_toolCallId, params, signal) =>
		pyDepAdd(params, signal, process.cwd()),
};

export const pyDepRemoveTool: ToolDefinition<
	typeof pyDepRemoveParameters,
	PyDepRemoveDetails | ToolErrorDetails
> = {
	name: "py_dep_remove",
	label: "Remove Python dependencies",
	description:
		"Remove bare PyPI package names with the developer-configured package manager. Fixed argv; no flags. Rewrites pyproject.toml and uv.lock and updates the venv.",
	promptSnippet: "Remove Python dependencies by bare name (no flags).",
	annotations: { readOnlyHint: false, destructiveHint: true },
	parameters: pyDepRemoveParameters,
	outputSchema: pyDepRemoveDetailsSchema,
	exposure: "direct",
	defaultActive: false,
	execute: (_toolCallId, params, signal) =>
		pyDepRemove(params, signal, process.cwd()),
};
