import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runTool } from "../../src/errors.ts";
import { bindCompanionConfig } from "../config.ts";
import { pyFormatWrite, pyFormatWriteTool } from "./format-write.ts";

/** Registers the P0 Python companion tools (P1 tools land separately). */
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
}
