import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { test } from "node:test";
import { execFixed } from "../../../companions/process.ts";

const NODE = process.execPath;

test("execFixed resolves (does not throw) on non-zero exit", async () => {
	const out = await execFixed(NODE, ["-e", "process.exit(3)"], process.cwd());
	assert.equal(out.code, 3);
	assert.equal(out.timedOut, false);
	assert.equal(out.truncated, false);
});

test("execFixed captures stdout and stderr per stream", async () => {
	const out = await execFixed(
		NODE,
		["-e", 'console.log("out"); console.error("err")'],
		process.cwd(),
	);
	assert.equal(out.code, 0);
	assert.match(out.stdout, /out/);
	assert.match(out.stderr, /err/);
});

test("execFixed caps multi-byte UTF-8 output at 100 KB BYTES, no split characters", async () => {
	const out = await execFixed(
		NODE,
		[
			"-e",
			'process.stdout.write("\u{1F600}".repeat(40000)); process.stderr.write("\u00e9".repeat(70000))',
		],
		process.cwd(),
	);
	assert.equal(out.truncated, true);
	assert.ok(
		Buffer.byteLength(out.stdout, "utf8") <= 100_000,
		`stdout ${Buffer.byteLength(out.stdout, "utf8")} bytes`,
	);
	assert.ok(
		Buffer.byteLength(out.stderr, "utf8") <= 100_000,
		`stderr ${Buffer.byteLength(out.stderr, "utf8")} bytes`,
	);
	// valid UTF-8 round-trip: no replacement or split characters
	assert.ok(!out.stdout.includes("\uFFFD"));
	assert.ok(!out.stderr.includes("\uFFFD"));
	assert.equal(Buffer.from(out.stdout, "utf8").toString("utf8"), out.stdout);
	assert.equal(Buffer.from(out.stderr, "utf8").toString("utf8"), out.stderr);
});

test("execFixed caps each stream at 100 KB and sets truncated", async () => {
	const out = await execFixed(
		NODE,
		[
			"-e",
			'process.stdout.write("a".repeat(150000)); process.stderr.write("b".repeat(150000))',
		],
		process.cwd(),
	);
	assert.equal(out.truncated, true);
	assert.ok(out.stdout.length <= 100_000, `stdout ${out.stdout.length}`);
	assert.ok(out.stderr.length <= 100_000, `stderr ${out.stderr.length}`);
});

test("execFixed times out and kills the child", async () => {
	const out = await execFixed(
		NODE,
		["-e", "setTimeout(() => {}, 60000)"],
		process.cwd(),
		{ timeoutMs: 500 },
	);
	assert.equal(out.timedOut, true);
	// killed, not completed
	assert.notEqual(out.code, 0);
});

test("execFixed SIGKILLs a child that traps SIGTERM (timeout escalation)", async () => {
	const started = Date.now();
	const out = await execFixed(
		NODE,
		["-e", "process.on('SIGTERM', () => {}); setTimeout(() => {}, 8000)"],
		process.cwd(),
		{ timeoutMs: 500 },
	);
	assert.equal(out.timedOut, true);
	assert.ok(
		Date.now() - started < 4000,
		"a SIGTERM-trapping child must be SIGKILLed, not waited out",
	);
});

test("execFixed merges opts.env into the child environment", async () => {
	const out = await execFixed(
		NODE,
		[
			"-e",
			'process.stdout.write(process.env.GIT_LITERAL_PATHSPECS ?? "missing")',
		],
		process.cwd(),
		{ env: { GIT_LITERAL_PATHSPECS: "1" } },
	);
	assert.equal(out.stdout, "1");
});

test("execFixed spawns fixed programs: every spawn is patchable and recorded", async () => {
	const simple = childProcess.spawn as (
		p: string,
		a: string[],
		o?: object,
	) => childProcess.ChildProcess;
	const orig = childProcess.spawn;
	const seen: string[][] = [];
	(childProcess as { spawn: unknown }).spawn = (
		program: string,
		spawnArgs: string[],
		opts?: object,
	) => {
		seen.push([program, ...spawnArgs]);
		return simple(program, spawnArgs, opts);
	};
	try {
		await execFixed("echo", ["hi"], process.cwd());
	} finally {
		(childProcess as { spawn: unknown }).spawn = orig;
	}
	assert.deepEqual(seen, [["echo", "hi"]]);
});
