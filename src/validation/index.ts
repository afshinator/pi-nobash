import type {
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadValidationConfig } from "../config.ts";
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

export function registerValidationTools(
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): void {
	// Snapshot the trusted config once per session cwd (F1/F7): a later model edit
	// to .pi/pi-nobash.json cannot change the invoked program/args this session.
	const snapshots = new Map<string, ValidationSnapshot>();
	const snapshotFor = (dir: string): ValidationSnapshot => {
		let snap = snapshots.get(dir);
		if (!snap) {
			try {
				snap = { config: loadValidationConfig(dir) };
			} catch (error) {
				snap = { error };
			}
			snapshots.set(dir, snap);
		}
		return snap;
	};
	// Prime the registration cwd; a context cwd that differs is snapshotted on first use.
	snapshotFor(cwd);
	pi.registerTool({
		...runValidationTool,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
			runValidation(params, signal, ctx.cwd, snapshotFor(ctx.cwd)),
	});
}
