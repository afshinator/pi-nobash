import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runTool } from "../../src/errors.ts";
import { bindCompanionConfig } from "../config.ts";
import { jsFormatWrite, jsFormatWriteTool } from "./format-write.ts";
import { jsLintFix, jsLintFixTool } from "./lint-fix.ts";

/** Registers the JavaScript companion tools (format + safe lint fix). */
export function registerJsTools(pi: ExtensionAPI): void {
	const getConfig = bindCompanionConfig(pi);
	pi.registerTool({
		...jsFormatWriteTool,
		// getConfig runs INSIDE runTool so a PARSE_ERROR / foreign-cwd
		// INVALID_ARGUMENT reaches the model as the C3 envelope, not a bare
		// thrown message (Pi converts a throw to details: {}).
		execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
			runTool(async () =>
				jsFormatWrite(
					params,
					signal,
					ctx.cwd,
					getConfig(ctx).javascript.formatter,
				),
			),
	});
	pi.registerTool({
		...jsLintFixTool,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
			runTool(async () =>
				jsLintFix(params, signal, ctx.cwd, getConfig(ctx).javascript.linter),
			),
	});
}
