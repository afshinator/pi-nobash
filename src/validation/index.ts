import { realpathSync } from "node:fs";
import type {
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadValidationConfig } from "../config.ts";
import { ToolError } from "../errors.ts";
import {
	checkResultSchema,
	runValidation,
	type ValidationSnapshot,
} from "./execute.ts";

const parameters = Type.Object({
	check: Type.String({
		description: "Name of a developer-configured validation check",
	}),
	targets: Type.Optional(
		Type.Array(Type.String(), {
			maxItems: 50,
			description: "Approved test targets for file-mode checks",
		}),
	),
});

export const runValidationTool: ToolDefinition<typeof parameters, unknown> = {
	name: "run_validation",
	label: "Run validation",
	description:
		"Run a named, developer-configured validation check. Targets are optional and only allowed for checks configured with file targets.",
	parameters,
	outputSchema: checkResultSchema,
	exposure: "direct",
	defaultActive: false,
	execute: (_toolCallId, params, signal) => runValidation(params, signal),
};

function readSnapshot(dir: string): ValidationSnapshot {
	try {
		return { config: loadValidationConfig(dir) };
	} catch (error) {
		return { error };
	}
}

/** Same directory may arrive as /var/... vs /private/var/... (macOS) or via symlink. */
function normalizeCwd(dir: string): string {
	try {
		return realpathSync(dir);
	} catch {
		return dir;
	}
}

export function registerValidationTools(
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): void {
	// C9: the governing snapshot is read once when the session starts, for the
	// SESSION cwd (pi.on("session_start") fires before any model turn). The
	// registration-cwd snapshot is only a fallback for direct/unit callers that
	// never start a session. A ctx.cwd other than the bound session cwd is
	// rejected rather than lazily loading that directory's config (D3/F7 deleted).
	const fallback = readSnapshot(cwd);
	const sessions = new Map<
		string,
		{ cwd: string; snapshot: ValidationSnapshot }
	>();
	pi.on("session_start", (_event, ctx) => {
		sessions.set(ctx.sessionManager.getSessionId(), {
			cwd: normalizeCwd(ctx.cwd),
			snapshot: readSnapshot(ctx.cwd),
		});
	});
	pi.registerTool({
		...runValidationTool,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => {
			const bound = sessions.get(ctx.sessionManager.getSessionId());
			const snapshot = bound?.snapshot ?? fallback;
			const ok = normalizeCwd(ctx.cwd) === (bound?.cwd ?? normalizeCwd(cwd));
			return runValidation(
				params,
				signal,
				ctx.cwd,
				ok
					? snapshot
					: {
							error: new ToolError(
								"INVALID_ARGUMENT",
								"no validation config loaded for this workspace",
							),
						},
			);
		},
	});
}
