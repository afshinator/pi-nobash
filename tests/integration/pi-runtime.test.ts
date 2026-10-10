import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import piNoBash from "../../extensions/pi-nobash.ts";
import {
	PACKAGE_NAME,
	PACKAGE_VERSION,
	REPLACEMENT_TOOL_NAMES,
	TARGET_PI,
} from "../../src/constants.ts";
import { BASH_BLOCK_REASON } from "../../src/pi-guard.ts";
import { buildStatusReport } from "../../src/status.ts";

const cwd = process.cwd();
let agentDir: string;
const sessions: Array<{ dispose(): void }> = [];

function makeLoader(withExtension: boolean) {
	return new DefaultResourceLoader({
		cwd,
		agentDir,
		noExtensions: true,
		...(withExtension
			? { extensionFactories: [{ name: "pi-nobash", factory: piNoBash }] }
			: {}),
	});
}

async function makeSession(
	loader: DefaultResourceLoader,
	options: {
		tools?: string[];
		noTools?: "all" | "builtin";
	} = {},
) {
	const { session, extensionsResult } = await createAgentSession({
		cwd,
		agentDir,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(cwd),
		...options,
	});
	sessions.push(session);
	return { session, extensionsResult };
}

function allNames(session: {
	getAllTools(): Array<{ name: string }>;
}): string[] {
	return session
		.getAllTools()
		.map((t) => t.name)
		.sort();
}

before(() => {
	agentDir = mkdtempSync(path.join(tmpdir(), "pi-nobash-agent-"));
});

after(() => {
	for (const s of sessions.splice(0)) s.dispose();
	rmSync(agentDir, { recursive: true, force: true });
});

test("I1: real loader loads extensions/pi-nobash.ts with no errors", async () => {
	const loader = makeLoader(true);
	await loader.reload();
	const { extensionsResult } = await makeSession(loader);
	assert.deepEqual(extensionsResult.errors, []);
	assert.ok(
		extensionsResult.extensions.some(
			(e) => (e as { path?: string }).path === "<inline:pi-nobash>",
		),
		"inline pi-nobash extension is present",
	);
});

test("I2: all 7 replacement tools are registered against the real runtime", async () => {
	const loader = makeLoader(true);
	await loader.reload();
	const { session } = await makeSession(loader, {
		tools: [...REPLACEMENT_TOOL_NAMES],
		noTools: "all",
	});
	for (const name of REPLACEMENT_TOOL_NAMES) {
		assert.ok(
			session.getToolDefinition(name),
			`missing registered tool: ${name}`,
		);
	}
	const names = allNames(session);
	for (const name of REPLACEMENT_TOOL_NAMES) {
		assert.ok(names.includes(name), `getAllTools() missing: ${name}`);
	}
});

test("I3: replacements stay inactive when the package loads without naming them", async () => {
	const loader = makeLoader(true);
	await loader.reload();
	const { session } = await makeSession(loader);
	const names = allNames(session);
	for (const name of REPLACEMENT_TOOL_NAMES) {
		assert.ok(names.includes(name), `tool should be registered: ${name}`);
	}
	const active = session.getActiveToolNames();
	for (const name of REPLACEMENT_TOOL_NAMES) {
		assert.equal(
			active.includes(name),
			false,
			`${name} should be inactive by default`,
		);
	}
});

test("I4: plain-name allowlist coexists with the extension; general runners absent", async () => {
	const loader = makeLoader(true);
	await loader.reload();
	const { session } = await makeSession(loader, {
		tools: ["read", "grep", "find", "ls", "json_query", "query_jsonl"],
		noTools: "all",
	});
	assert.deepEqual(session.getActiveToolNames(), [
		"read",
		"grep",
		"find",
		"ls",
		"json_query",
		"query_jsonl",
	]);
	for (const name of ["bash", "powershell", "codemode"]) {
		assert.equal(
			session.getActiveToolNames().includes(name),
			false,
			`${name} should be absent`,
		);
	}
});

test("I5/I6: two sessions can activate different tool subsets", async () => {
	const loader = makeLoader(true);
	await loader.reload();
	const a = await makeSession(loader, {
		tools: ["read", "json_query"],
		noTools: "all",
	});
	const b = await makeSession(loader, {
		tools: ["grep", "git_status"],
		noTools: "all",
	});
	assert.deepEqual(a.session.getActiveToolNames(), ["read", "json_query"]);
	assert.deepEqual(b.session.getActiveToolNames(), ["grep", "git_status"]);
});

test("I8: status report carries all five AC10 items with real tool names", async () => {
	const loader = makeLoader(true);
	await loader.reload();
	const { session } = await makeSession(loader, {
		tools: ["read", "json_query"],
		noTools: "all",
	});
	const report = buildStatusReport({
		packageName: PACKAGE_NAME,
		packageVersion: PACKAGE_VERSION,
		targetPi: TARGET_PI,
		activeTools: session.getActiveToolNames(),
		allToolNames: session.getAllTools().map((t) => t.name),
		replacementToolNames: REPLACEMENT_TOOL_NAMES,
	});
	assert.match(report, new RegExp(PACKAGE_NAME));
	assert.match(report, new RegExp(PACKAGE_VERSION));
	assert.match(report, /active tools:/);
	assert.match(report, /json_query/);
	assert.match(report, /known general execution:/);
	assert.match(report, /pi-nobash tools:/);
	assert.match(report, /configuration:/);
});

test("I9: package removal leaves replacement tools/status absent; unrelated selection works", async () => {
	const empty = makeLoader(false);
	await empty.reload();
	const { session } = await makeSession(empty, {
		tools: ["read"],
		noTools: "all",
	});
	const names = allNames(session);
	for (const name of REPLACEMENT_TOOL_NAMES) {
		assert.equal(
			names.includes(name),
			false,
			`${name} should be absent after removal`,
		);
	}
	assert.deepEqual(session.getActiveToolNames(), ["read"]);
});

test("I7: bash backstop blocks direct bash in a real Pi session", async () => {
	const work = mkdtempSync(path.join(tmpdir(), "pi-nobash-i7-"));
	const sentinel = path.join(work, "sentinel.txt");
	const command = `touch ${JSON.stringify(sentinel)}`;

	// Positive control: the same command really creates the sentinel when run
	// as a plain bash invocation (no pi-nobash anywhere in the loop).
	execFileSync("bash", ["-c", command], { cwd: work });
	assert.equal(
		existsSync(sentinel),
		true,
		"control: bash must be able to create the sentinel",
	);
	rmSync(sentinel, { force: true });

	// pi-nobash session with bash deliberately re-exposed.
	const loader = makeLoader(true);
	await loader.reload();
	const { session } = await makeSession(loader, {
		tools: ["read", "bash"],
		noTools: "all",
	});
	assert.equal(
		session.getActiveToolNames().includes("bash"),
		true,
		"bash is re-exposed",
	);

	const res = await session.extensionRunner.emitToolCall({
		type: "tool_call",
		toolCallId: "i7",
		toolName: "bash",
		input: { command, description: "create sentinel" },
	});
	assert.equal(res?.block, true, "bash tool_call must be blocked");
	assert.equal(res?.reason, BASH_BLOCK_REASON);
	assert.equal(existsSync(sentinel), false, "sentinel must not be created");

	// Non-bash tool calls are not blocked.
	const readRes = await session.extensionRunner.emitToolCall({
		type: "tool_call",
		toolCallId: "i7-read",
		toolName: "read",
		input: { path: "package.json" },
	});
	assert.notEqual(readRes?.block, true, "read tool_call must not be blocked");

	rmSync(work, { recursive: true, force: true });
});
