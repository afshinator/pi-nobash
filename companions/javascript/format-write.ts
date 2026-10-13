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
import { JS_FORMATTERS, type JsFormatter } from "../config.ts";
import { execFixed } from "../process.ts";

/**
 * P0-5 js_format_write. Formats named project files in place with the
 * developer-configured backend (companions.javascript.formatter). The model
 * can never choose a backend, flag, or config path — the schema carries paths
 * only. Formatter project-config discovery (prettier.config / biome.json) is
 * the formatter's own; this tool passes no formatting flags.
 */
export const MAX_FORMAT_PATHS = 50;

const DENY_SEGMENTS = new Set(["node_modules", ".git", "dist", "build"]);

/** Fixed per-backend handled-extension sets (P0-5). */
const EXTENSIONS: Record<JsFormatter, ReadonlySet<string>> = {
	prettier: new Set([
		".ts",
		".tsx",
		".js",
		".jsx",
		".mjs",
		".cjs",
		".json",
		".css",
		".scss",
		".md",
		".yaml",
		".yml",
		".html",
	]),
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
};

const TIMEOUT_MS = 120_000;

export const formatWriteDetailsSchema = Type.Object({
	formatted: Type.Array(Type.String()),
	truncated: Type.Boolean(),
});

export const parameters = Type.Object({
	paths: Type.Array(Type.String(), {
		minItems: 1,
		maxItems: MAX_FORMAT_PATHS,
		description: "Project files to format (workspace-relative)",
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
	formatter: JsFormatter,
	timeoutMs: number = TIMEOUT_MS,
): Promise<ToolBody<FormatWriteDetails>> {
	return runTool(async () => {
		if (params.paths.length > MAX_FORMAT_PATHS)
			throw new ToolError(
				"LIMIT_EXCEEDED",
				`too many paths (max ${MAX_FORMAT_PATHS})`,
			);
		const allowed = EXTENSIONS[formatter];
		const realCwd = realpathSync(cwd);
		const resolved = params.paths.map((p) => {
			const segments = p.split("/");
			if (segments[segments.length - 1]?.startsWith("-"))
				throw new ToolError(
					"INVALID_ARGUMENT",
					`option-like path is not allowed: ${p}`,
				);
			for (const seg of segments)
				if (DENY_SEGMENTS.has(seg.toLowerCase()))
					throw new ToolError(
						"PATH_OUT_OF_SCOPE",
						`path inside ${seg}/ is not formattable: ${p}`,
					);
			const ext = path.extname(p);
			if (!allowed.has(ext))
				throw new ToolError(
					"INVALID_ARGUMENT",
					`${formatter} does not format ${ext || "files without extension"}: ${p}`,
				);
			const abs = validateWorkspaceFile(cwd, p);
			// Deny again on the RESOLVED path: a case-variant segment or an
			// in-workspace symlink alias must not reach node_modules/.git/dist/build.
			for (const seg of path
				.relative(realCwd, realpathSync(abs))
				.split(path.sep))
				if (DENY_SEGMENTS.has(seg.toLowerCase()))
					throw new ToolError(
						"PATH_OUT_OF_SCOPE",
						`path inside ${seg}/ is not formattable: ${p}`,
					);
			return abs;
		});
		const invocation = JS_FORMATTERS[formatter];
		const outcome = await execFixed(
			invocation.program,
			[...invocation.args, ...resolved],
			cwd,
			{ timeoutMs, signal },
		);
		if (outcome.timedOut)
			throw new ToolError(
				"TIMEOUT",
				`${formatter} format timed out after ${timeoutMs} ms`,
			);
		if (outcome.code !== 0)
			throw new ToolError(
				"VALIDATION_FAILED",
				`${formatter} format failed (exit ${outcome.code}): ${outcome.stderr || outcome.stdout}`,
			);
		// Conservative details: exit 0 means every validated path was formatted;
		// formatter stdout layouts are not parsed.
		// shortcut: details.formatted echoes the input paths, not formatter output.
		return successResult(`formatted ${resolved.length} file(s)`, {
			formatted: [...params.paths],
			truncated: outcome.truncated,
		});
	});
}

/** Direct-caller body (tests, the registrar); formatter passed explicitly. */
export function jsFormatWrite(
	params: { paths: string[] },
	signal: AbortSignal | undefined,
	cwd: string,
	formatter: JsFormatter,
	timeoutMs?: number,
): Promise<ToolBody<FormatWriteDetails>> {
	return formatWriteImpl(params, signal, cwd, formatter, timeoutMs);
}

export const jsFormatWriteTool: ToolDefinition<
	typeof parameters,
	FormatWriteDetails | ToolErrorDetails
> = {
	name: "js_format_write",
	label: "Format JS/TS files",
	description:
		"Format named project files in place with the developer-configured formatter (Prettier or Biome from .pi/pi-nobash-companions.json). Fixed argv; no backend, flag, or config field.",
	promptSnippet:
		"Format named project files in place (developer-configured Prettier/Biome).",
	annotations: { readOnlyHint: false },
	parameters,
	outputSchema: formatWriteDetailsSchema,
	exposure: "direct",
	defaultActive: false,
	execute: (_toolCallId, params, signal) =>
		jsFormatWrite(params, signal, process.cwd(), "prettier"),
};
