/**
 * WO-10: two SDK sessions from the SAME resource loader / inline extension
 * factory, with DIFFERENT cwds, must each run their own .pi/pi-nobash.json
 * check — and re-prompting the first session must not pick up the second
 * session's snapshot (the old single-closure binding clobbered it on bind).
 *
 * src/validation/index.ts (WO-7) keys the session_start snapshot by
 * ctx.sessionManager.getSessionId(), so A → B → A interleaving exercises the
 * keyed lookup, not just a fresh bind.
 *
 * RED evidence: run against HEAD's single-closure src/validation/index.ts
 * (session B's bind overwrites the one snapshot; session A's second
 * run_validation would execute marker-B and the A2 assertion fails).
 */
import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import piNoBash from "../../extensions/pi-nobash.ts";
import { createFauxHarness, createFauxToolSession } from "./helpers.ts";

const dirs: string[] = [];
function scratch(label: string): string {
	const dir = realpathSync(
		mkdtempSync(path.join(tmpdir(), `pi-nobash-multi-${label}-`)),
	);
	dirs.push(dir);
	return dir;
}
after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function makeWorkspace(dir: string, marker: string): void {
	mkdirSync(path.join(dir, ".pi"));
	writeFileSync(
		path.join(dir, ".pi/pi-nobash.json"),
		JSON.stringify({
			validation: {
				checks: {
					echo_marker: {
						program: "node",
						args: ["-e", `console.log("${marker}")`],
						cwd: ".",
						timeoutMs: 10_000,
						targets: { mode: "none" },
					},
				},
			},
		}),
	);
}

type ToolEnd = {
	result: {
		isError?: boolean;
		details: { code?: string; stdout?: string; message?: string };
	};
};

function runValidationEnd(events: Array<Record<string, unknown>>): ToolEnd {
	const end = events.find(
		(e) =>
			e.type === "tool_execution_end" &&
			(e as { toolName?: string }).toolName === "run_validation",
	) as ToolEnd | undefined;
	assert.ok(end, "run_validation was never executed in the real session");
	return end;
}

test("C9: sessions from one loader with different cwds each run their own check", {
	timeout: 120_000,
}, async () => {
	const workA = scratch("a");
	const workB = scratch("b");
	makeWorkspace(workA, "marker-from-workspace-A");
	makeWorkspace(workB, "marker-from-workspace-B");
	const agentDir = scratch("agent");

	const harness = await createFauxHarness({
		agentDir,
		factories: [{ name: "pi-nobash", factory: piNoBash }],
	});
	// Sequential turns consume the queue in order: A, B, A again.
	harness.faux.setResponses([
		fauxAssistantMessage(
			fauxToolCall("run_validation", { check: "echo_marker" }),
		),
		fauxAssistantMessage("A turn 1 done"),
		fauxAssistantMessage(
			fauxToolCall("run_validation", { check: "echo_marker" }),
		),
		fauxAssistantMessage("B turn done"),
		fauxAssistantMessage(
			fauxToolCall("run_validation", { check: "echo_marker" }),
		),
		fauxAssistantMessage("A turn 2 done"),
	]);

	const { session: sessionA } = await createFauxToolSession({
		cwd: workA,
		agentDir,
		tools: ["run_validation"],
		harness,
	});
	const { session: sessionB } = await createFauxToolSession({
		cwd: workB,
		agentDir,
		tools: ["run_validation"],
		harness,
	});
	assert.notEqual(
		sessionA.sessionId,
		sessionB.sessionId,
		"sessions must have distinct ids (the snapshot is keyed by them)",
	);

	const eventsA: Array<Record<string, unknown>> = [];
	const eventsB: Array<Record<string, unknown>> = [];
	sessionA.subscribe((e) => eventsA.push(e as Record<string, unknown>));
	sessionB.subscribe((e) => eventsB.push(e as Record<string, unknown>));

	// Session A, turn 1: runs A's own check.
	await sessionA.prompt("run the echo_marker validation check");
	const a1 = runValidationEnd(eventsA);
	assert.ok(
		a1.result.isError !== true,
		`A turn 1 failed: ${JSON.stringify(a1.result.details)}`,
	);
	assert.match(
		a1.result.details.stdout ?? "",
		/marker-from-workspace-A/,
		"A turn 1 must execute A's own configured check",
	);

	// Session B: runs B's own check, not A's.
	await sessionB.prompt("run the echo_marker validation check");
	const b1 = runValidationEnd(eventsB);
	assert.ok(
		b1.result.isError !== true,
		`B turn failed: ${JSON.stringify(b1.result.details)}`,
	);
	assert.match(
		b1.result.details.stdout ?? "",
		/marker-from-workspace-B/,
		"session B must execute B's own configured check",
	);

	// Session A again: must still run A's check after B was bound.
	await sessionA.prompt("run the echo_marker validation check again");
	const a2 = runValidationEnd(eventsA.slice().reverse());
	assert.ok(
		a2.result.isError !== true,
		`A turn 2 failed: ${JSON.stringify(a2.result.details)}`,
	);
	assert.match(
		a2.result.details.stdout ?? "",
		/marker-from-workspace-A/,
		"A turn 2 must still execute A's check, not the snapshot B's bind installed",
	);

	sessionA.dispose();
	sessionB.dispose();
});
