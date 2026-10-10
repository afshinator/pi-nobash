/**
 * Real `pi` CLI-process coverage (WoD criterion 2).
 *
 * Spawns node_modules/.bin/pi as a child process (not createAgentSession):
 * - (a) `pi install <local-path>` / `pi remove` against an isolated agent dir,
 *   asserting the isolated settings.json gains and then loses the pi-nobash entry.
 * - (b) One provider-backed headless invocation exercising the `--tools`
 *   allowlist. Pi 1.1.0 has NO model-free tool-introspection command
 *   (verified: `pi --help`, `pi list`, cli/args.js, modes/rpc — none dump
 *   active tools). However `pi --mode json -p` emits a `message_start`
 *   system event whose `toolsAdded` array lists the resolved active tools,
 *   so the allowlist is asserted on real process output.
 */
import assert from "node:assert/strict";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import piNoBash from "../../extensions/pi-nobash.ts";
import { createFauxToolSession, runPi } from "./helpers.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const C9_MARKER = "c9-validation-ran-marker";
// Cheap model on a provider this machine has credentials for (see
// `pi auth check --json --provider deepseek`). Cost: one ~100-token call.
const PROVIDER = "deepseek";
const MODEL = "deepseek-v4-flash";

const dirs: string[] = [];
function scratch(label: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), `pi-nobash-cli-${label}-`));
	dirs.push(dir);
	return dir;
}
function cleanupDirs(): void {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
}
after(cleanupDirs);
// N4: an after() hook does not run on a crash; remove the scratch dirs (which
// may hold an auth.json copy) at process exit and on termination signals too.
process.once("exit", cleanupDirs);
process.once("SIGINT", () => {
	cleanupDirs();
	process.exit(130);
});
process.once("SIGTERM", () => {
	cleanupDirs();
	process.exit(143);
});
process.once("uncaughtException", (error) => {
	cleanupDirs();
	throw error;
});
process.once("unhandledRejection", (reason) => {
	cleanupDirs();
	throw reason;
});

test("pi install <local-path> then pi remove updates isolated settings.json", async () => {
	const agentDir = scratch("agent");
	const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
	const settingsPath = path.join(agentDir, "settings.json");

	const install = await runPi(["install", REPO_ROOT], { cwd: REPO_ROOT, env });
	assert.equal(install.code, 0, `install failed: ${install.stderr}`);
	assert.match(install.stdout, /Installed/);
	const installedSettings = readFileSync(settingsPath, "utf8");
	assert.match(
		installedSettings,
		/pi-nobash/,
		`settings should reference pi-nobash after install, got: ${installedSettings}`,
	);

	const list = await runPi(["list"], { cwd: REPO_ROOT, env });
	assert.equal(list.code, 0);
	assert.match(list.stdout, /pi-nobash/);

	const remove = await runPi(["remove", REPO_ROOT], { cwd: REPO_ROOT, env });
	assert.equal(remove.code, 0, `remove failed: ${remove.stderr}`);
	assert.match(remove.stdout, /Removed/);
	const removedSettings = readFileSync(settingsPath, "utf8");
	assert.doesNotMatch(
		removedSettings,
		/pi-nobash/,
		`settings should not reference pi-nobash after remove, got: ${removedSettings}`,
	);
});

test("--tools allowlist restricts the active tool set in a real pi process", {
	timeout: 180_000,
}, async (t) => {
	// N2: the live provider call is opt-in so the default suite is offline and
	// credential-free; set PI_NOBASH_LIVE_PROVIDER=1 to run it.
	if (process.env.PI_NOBASH_LIVE_PROVIDER !== "1") {
		t.skip(
			"live provider call is opt-in: set PI_NOBASH_LIVE_PROVIDER=1 (default suite must be offline and credential-free)",
		);
		return;
	}
	// Skip with a verified reason when no deepseek credentials are available.
	const agentDir = scratch("agent");
	const realAuth = path.join(homedir(), ".pi/agent/auth.json");
	if (existsSync(realAuth))
		copyFileSync(realAuth, path.join(agentDir, "auth.json"));
	const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
	const authCheck = await runPi(
		["auth", "check", "--json", "--provider", PROVIDER],
		{
			cwd: REPO_ROOT,
			env,
		},
	);
	if (!authCheck.stdout.includes('"status":"ready"')) {
		t.skip(
			`provider ${PROVIDER} not ready: ${(authCheck.stdout || authCheck.stderr).trim()}`,
		);
		return;
	}

	const workspace = scratch("work");
	const marker = "nobash-cli-marker-42";
	writeFileSync(path.join(workspace, "hello.txt"), `${marker}\n`);

	const run = await runPi(
		[
			"--provider",
			PROVIDER,
			"--model",
			MODEL,
			"-p",
			"--mode",
			"json",
			"--no-session",
			"-ne",
			"-ns",
			"-nc",
			"-np",
			"--no-mcp",
			"-t",
			"read",
			"Use the read tool to read hello.txt and reply with its exact contents.",
		],
		{ cwd: workspace, env, timeoutMs: 120_000 },
	);
	assert.equal(
		run.code,
		0,
		`pi -p failed: ${run.stderr}\n${run.stdout.slice(0, 2000)}`,
	);

	const events = run.stdout
		.split("\n")
		.filter((line) => line.startsWith("{"))
		.map((line) => JSON.parse(line) as Record<string, unknown>);

	// The system prompt event carries the resolved active tools.
	const systemEvents = events.filter(
		(e) =>
			e.type === "message_start" &&
			(e.message as { role?: string })?.role === "system",
	) as Array<{ message: { sections: { tools: string } } }>;
	const systemEvent = systemEvents.at(0);
	assert.ok(systemEvent, "no system message_start event in JSON stream");
	const toolNames = [
		...systemEvent.message.sections.tools.matchAll(/^- (\w+):/gm),
	].map((m) => m[1]);
	assert.deepEqual(
		toolNames,
		["read"],
		`--tools read allowlist not honored, active tools: ${toolNames.join(",")}`,
	);

	// The agent actually used the read tool, and never bash.
	const toolStarts = events.filter(
		(e) => e.type === "tool_execution_start",
	) as Array<{ toolName: string }>;
	assert.ok(
		toolStarts.some((t) => t.toolName === "read"),
		"read tool was never executed",
	);
	assert.ok(
		!toolStarts.some((t) => t.toolName === "bash"),
		"bash must not be executable under the -t read allowlist",
	);
	assert.match(run.stdout, new RegExp(marker));

	// N4: scope the copy to the spawn; the copy must not outlive the run.
	const copiedAuth = path.join(agentDir, "auth.json");
	if (existsSync(copiedAuth)) rmSync(copiedAuth);
	assert.equal(
		existsSync(copiedAuth),
		false,
		"auth.json copy must be gone once the spawned pi run completes",
	);
});

/*
 * WO-5/WO-8: real-runtime evidence that the C9 snapshot works end to end.
 *
 * Empirical facts recorded while building this test (Pi 1.1.0):
 * - The extension factory API passes NO cwd (ExtensionFactory = (pi) => void);
 *   since WO-7, src/validation binds the snapshot to ctx.cwd in the
 *   session_start handler, so the SESSION cwd governs, not process.cwd().
 *   This session's cwd differs from process.cwd() on purpose: the check comes
 *   from the session's own .pi/pi-nobash.json and process.cwd() stays the
 *   repo root (asserted below), so a registration-cwd-bound implementation
 *   would return NOT_FOUND here instead.
 * - ctx.cwd on a real tool execution is the session cwd; it cannot be forged
 *   to a foreign value in a real session, so the C9/A10 foreign-cwd rejection
 *   is only reachable at unit level (tests/unit/validation/tool.test.ts) and
 *   is NOT re-asserted here.
 */
test("C9: real session runs run_validation from the session's .pi/pi-nobash.json", {
	timeout: 60_000,
}, async () => {
	const work = realpathSync(scratch("c9"));
	const agentDir = scratch("c9-agent");
	mkdirSync(path.join(work, ".pi"));
	const checkProgram = `const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(path.join(work, "sentinel.txt"))}, "ok");
console.log("${C9_MARKER}");`;
	writeFileSync(
		path.join(work, ".pi/pi-nobash.json"),
		JSON.stringify({
			validation: {
				checks: {
					echo_marker: {
						program: "node",
						args: ["-e", checkProgram],
						cwd: ".",
						timeoutMs: 10_000,
						targets: { mode: "none" },
					},
				},
			},
		}),
	);

	// The session cwd differs from process.cwd(): only a session_start-bound
	// snapshot can find this check. Process cwd must stay the repo root.
	assert.equal(
		process.cwd(),
		REPO_ROOT,
		"test must not chdir; the session cwd must differ from process.cwd()",
	);
	assert.notEqual(work, process.cwd());

	const { session } = await createFauxToolSession({
		cwd: work,
		agentDir,
		tools: ["run_validation"],
		factories: [{ name: "pi-nobash", factory: piNoBash }],
		responses: [
			fauxAssistantMessage(
				fauxToolCall("run_validation", { check: "echo_marker" }),
			),
			fauxAssistantMessage("check done"),
		],
	});
	const events: Array<Record<string, unknown>> = [];
	session.subscribe((event) => events.push(event as Record<string, unknown>));
	await session.prompt("run the echo_marker validation check");

	const end = events.find(
		(e) =>
			e.type === "tool_execution_end" &&
			(e as { toolName?: string }).toolName === "run_validation",
	) as
		| {
				result: {
					isError: boolean;
					details: { code?: string; stdout?: string; message?: string };
				};
		  }
		| undefined;
	assert.ok(end, "run_validation was never executed in the real session");
	assert.ok(
		end.result.isError !== true,
		`run_validation failed: ${JSON.stringify(end.result.details)}`,
	);
	assert.match(end.result.details.stdout ?? "", new RegExp(C9_MARKER));
	assert.equal(
		existsSync(path.join(work, "sentinel.txt")),
		true,
		"the configured check must have spawned a real node process",
	);
	session.dispose();
});

test("N4: the CLI test module registers crash-safe scratch cleanup", () => {
	assert.ok(
		process.listenerCount("exit") > 0,
		"an exit handler must remove scratch dirs (possible auth.json copies)",
	);
	assert.ok(process.listenerCount("SIGINT") > 0);
	assert.ok(process.listenerCount("SIGTERM") > 0);
	assert.ok(process.listenerCount("uncaughtException") > 0);
	assert.ok(process.listenerCount("unhandledRejection") > 0);
});
