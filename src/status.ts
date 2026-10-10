import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	KNOWN_GENERAL_EXECUTION_TOOLS,
	PACKAGE_NAME,
	PACKAGE_VERSION,
	REPLACEMENT_TOOL_NAMES,
	STATUS_COMMAND_NAME,
	TARGET_PI,
} from "./constants.ts";

export type StatusInput = {
	packageName: string;
	packageVersion: string;
	targetPi: string;
	activeTools: string[] | null;
	allToolNames: string[] | null;
	replacementToolNames: readonly string[];
};

function safeActiveTools(pi: ExtensionAPI): string[] | null {
	try {
		return pi.getActiveTools();
	} catch {
		return null;
	}
}

function safeAllToolNames(pi: ExtensionAPI): string[] | null {
	try {
		return pi.getAllTools().map((t) => t.name);
	} catch {
		return null;
	}
}

/** Pure AC10 report builder (spec §17.4). */
export function buildStatusReport(input: StatusInput): string {
	const lines: string[] = [];
	lines.push(`${input.packageName} ${input.packageVersion}`);
	lines.push(`target Pi: ${input.targetPi}`);

	const active = input.activeTools;
	const allNames = input.allToolNames;
	const activeGeneral = KNOWN_GENERAL_EXECUTION_TOOLS.filter(
		(t) => active?.includes(t) ?? false,
	);
	const conforming = active !== null && activeGeneral.length === 0;

	if (!conforming) lines.push("conformance: NONCONFORMING");

	lines.push("");
	lines.push("active tools:");
	if (active === null) {
		lines.push("  unavailable");
	} else if (active.length === 0) {
		lines.push("  (none)");
	} else {
		for (const t of active) lines.push(`  ${t}`);
	}

	lines.push("");
	lines.push("known general execution:");
	for (const t of KNOWN_GENERAL_EXECUTION_TOOLS) {
		const present = active?.includes(t) ?? false;
		if (present) {
			const note = t === "bash" ? " (direct calls blocked by pi-nobash)" : "";
			lines.push(`  ${t.padEnd(12)} PRESENT${note}`);
		} else {
			lines.push(`  ${t.padEnd(12)} absent`);
		}
	}

	lines.push("");
	lines.push("pi-nobash tools:");
	for (const t of input.replacementToolNames) {
		const available = allNames === null || allNames.includes(t);
		const isActive = active?.includes(t) ?? false;
		const state = !available ? "unavailable" : isActive ? "active" : "inactive";
		lines.push(`  ${t.padEnd(16)} ${state}`);
	}

	lines.push("");
	if (activeGeneral.length > 0) {
		lines.push(
			`configuration: known general-execution tool active: ${activeGeneral.join(", ")}`,
		);
	} else {
		lines.push("configuration:");
		lines.push("  none known");
	}

	return lines.join("\n");
}

/** Registers /nobash-status (spec §17.1). */
export function registerStatusCommand(pi: ExtensionAPI): void {
	pi.registerCommand(STATUS_COMMAND_NAME, {
		description:
			"Report pi-nobash package/version, active tools, known general execution tools, replacement tools, and configuration.",
		handler: async (_args, ctx) => {
			const report = buildStatusReport({
				packageName: PACKAGE_NAME,
				packageVersion: PACKAGE_VERSION,
				targetPi: TARGET_PI,
				activeTools: safeActiveTools(pi),
				allToolNames: safeAllToolNames(pi),
				replacementToolNames: REPLACEMENT_TOOL_NAMES,
			});
			ctx.ui.notify(report, "info");
		},
	});
}
