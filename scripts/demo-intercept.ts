/**
 * README demo driver. Loads the real pi-nobash extension into a real Pi
 * session and emits tool calls through the real `tool_call` pipeline, then
 * prints what the model would see.
 *
 * Deterministic and offline: the session uses a faux provider, so no
 * credentials, network, or tokens are involved. Only the model is canned —
 * the extension, the guard, and the tool pipeline are the shipped code.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import piNoBash from "../extensions/pi-nobash.ts";
import { createFauxToolSession } from "../tests/integration/helpers.ts";

const cwd = mkdtempSync(path.join(tmpdir(), "pi-nobash-demo-"));
const agentDir = mkdtempSync(path.join(tmpdir(), "pi-nobash-demo-agent-"));

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

console.log(bold("pi-nobash — no-general-execution demo"));
console.log();

const { session } = await createFauxToolSession({
	cwd,
	agentDir,
	// bash is deliberately re-exposed here to show the backstop still refuses it
	tools: ["read", "query_jsonl", "bash"],
	factories: [{ name: "pi-nobash", factory: piNoBash }],
});

const emit = (toolName: string, input: Record<string, unknown>) =>
	session.extensionRunner.emitToolCall({
		type: "tool_call",
		toolCallId: `demo-${toolName}`,
		toolName,
		input,
	});

console.log(`active tools: ${session.getActiveToolNames().join(", ")}`);
console.log(
	dim(
		"(bash re-exposed on purpose: the backstop is independent of tool selection)",
	),
);
console.log();

console.log(bold("agent → bash"));
console.log(dim('  { "command": "rm -rf node_modules && npm test" }'));
const bash = await emit("bash", {
	command: "rm -rf node_modules && npm test",
	description: "clean and test",
});
console.log(`pi-nobash → ${red("blocked")}`);
console.log(red(`  ${bash?.reason}`));
console.log();

console.log(bold("agent → query_jsonl"));
console.log(
	dim(
		'  { "path": "logs/build.jsonl", "limit": 10, "where": [{ "path": [{ "key": "status" }], "op": "eq", "value": "error" }] }',
	),
);
await emit("query_jsonl", {
	path: "logs/build.jsonl",
	malformedLine: "skip",
	limit: 10,
});
console.log(`pi-nobash → ${green("not blocked")}`);
console.log(
	green(
		"  the guard intercepts only the shell; typed tools pass to their implementation",
	),
);
console.log();

console.log(dim("every direct bash call is refused, even when re-exposed —"));
console.log(
	dim(
		"the blocker never reads the command text, so it cannot be talked around",
	),
);

session.dispose();
rmSync(cwd, { recursive: true, force: true });
rmSync(agentDir, { recursive: true, force: true });
