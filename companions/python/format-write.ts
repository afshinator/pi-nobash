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
import { PY_FORMATTERS } from "../config.ts";
import {
	assertToolPathEntry,
	assertToolPathResolved,
	execFixedChecked,
} from "../process.ts";

/**
 * P0-6 py_format_write. Formats named Python files in place with Ruff (the
 * only python.formatter enum member). The model can never choose a backend,
 * flag, or config path — the schema carries paths only. Ruff project-config
 * discovery ([tool.ruff] in pyproject.toml / ruff.toml) is Ruff's own; this
 * tool passes no formatting flags. `ruff` is resolved from PATH / the project
 * venv, same interpreter assumption as the python-venv checks template.
 */
const MAX_FORMAT_PATHS = 50;

const EXTENSIONS = new Set([".py", ".pyi"]);

const TIMEOUT_MS = 60_000;

const formatWriteDetailsSchema = Type.Object({
	formatted: Type.Array(Type.String()),
	truncated: Type.Boolean(),
});

const parameters = Type.Object({
	paths: Type.Array(Type.String(), {
		minItems: 1,
		maxItems: MAX_FORMAT_PATHS,
		description: "Python files to format (workspace-relative)",
	}),
});

export type FormatWriteDetails = {
	formatted: string[];
	truncated: boolean;
};

type ToolBody<T> = AgentToolResult<T | ToolErrorDetails>;

async function formatWriteImpl(
	params: { paths: string[] },
	signal: AbortSignal | undefined,
	cwd: string,
	formatter: "ruff" = "ruff",
	timeoutMs: number = TIMEOUT_MS,
): Promise<ToolBody<FormatWriteDetails>> {
	return runTool(async () => {
		if (params.paths.length > MAX_FORMAT_PATHS)
			throw new ToolError(
				"LIMIT_EXCEEDED",
				`too many paths (max ${MAX_FORMAT_PATHS})`,
			);
		const realCwd = realpathSync(cwd);
		const resolved = params.paths.map((p) => {
			assertToolPathEntry(p, "formattable");
			const ext = path.extname(p);
			if (!EXTENSIONS.has(ext))
				throw new ToolError(
					"INVALID_ARGUMENT",
					`ruff format only handles .py/.pyi: ${p}`,
				);
			const abs = validateWorkspaceFile(cwd, p);
			assertToolPathResolved(realCwd, abs, p, "formattable");
			return abs;
		});
		const invocation = PY_FORMATTERS[formatter];
		const outcome = await execFixedChecked(
			invocation.program,
			[...invocation.args, ...resolved],
			cwd,
			{ timeoutMs, signal },
			`${formatter} format`,
		);
		// Conservative details: exit 0 means every validated path was formatted.
		// shortcut: details.formatted echoes the input paths, not ruff output.
		return successResult(`formatted ${resolved.length} file(s)`, {
			formatted: [...params.paths],
			truncated: outcome.truncated,
		});
	});
}

/** Direct-caller body (tests, the registrar); formatter passed through the enum table. */
export function pyFormatWrite(
	params: { paths: string[] },
	signal: AbortSignal | undefined,
	cwd: string,
	formatter: "ruff" = "ruff",
	timeoutMs?: number,
): Promise<ToolBody<FormatWriteDetails>> {
	return formatWriteImpl(params, signal, cwd, formatter, timeoutMs);
}

export const pyFormatWriteTool: ToolDefinition<
	typeof parameters,
	FormatWriteDetails | ToolErrorDetails
> = {
	name: "py_format_write",
	label: "Format Python files",
	description:
		"Format named Python files in place with Ruff (developer-configured, from .pi/pi-nobash-companions.json). Fixed argv; no backend, flag, or config field.",
	promptSnippet:
		"Format named Python files in place (Ruff, developer-configured).",
	annotations: { readOnlyHint: false },
	parameters,
	outputSchema: formatWriteDetailsSchema,
	exposure: "direct",
	defaultActive: false,
	execute: (_toolCallId, params, signal) =>
		pyFormatWrite(params, signal, process.cwd()),
};
