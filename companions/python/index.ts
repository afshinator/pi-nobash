import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runTool } from "../../src/errors.ts";
import { bindCompanionConfig } from "../config.ts";
import { pyDepAdd, pyDepAddTool, pyDepRemove, pyDepRemoveTool } from "./dep.ts";
import { pyFormatWrite, pyFormatWriteTool } from "./format-write.ts";
import { pyLintFix, pyLintFixTool } from "./lint-fix.ts";

/** Registers the Python companion tools (format + safe lint fix + deps). */
export function registerPythonTools(pi: ExtensionAPI): void {
	const getConfig = bindCompanionConfig(pi);
	pi.registerTool({
		...pyFormatWriteTool,
		// getConfig runs INSIDE runTool so a PARSE_ERROR / foreign-cwd
		// INVALID_ARGUMENT reaches the model as the C3 envelope, not a bare
		// thrown message (Pi converts a throw to details: {}).
		execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
			runTool(async () =>
				pyFormatWrite(params, signal, ctx.cwd, getConfig(ctx).python.formatter),
			),
	});
	pi.registerTool({
		...pyLintFixTool,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
			runTool(async () =>
				pyLintFix(params, signal, ctx.cwd, getConfig(ctx).python.linter),
			),
	});
	// Dep tools LAST: formatters.test.ts takes tools[0] as the formatter.
	pi.registerTool({
		...pyDepAddTool,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
			runTool(async () =>
				pyDepAdd(params, signal, ctx.cwd, getConfig(ctx).python.packageManager),
			),
	});
	pi.registerTool({
		...pyDepRemoveTool,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
			runTool(async () =>
				pyDepRemove(
					params,
					signal,
					ctx.cwd,
					getConfig(ctx).python.packageManager,
				),
			),
	});
}
