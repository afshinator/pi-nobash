import { spawn } from "node:child_process";
import path from "node:path";
import type { ValidationCheck } from "../config.ts";
import { ToolError } from "../errors.ts";
import { resolveAdapter } from "./adapter.ts";
import { resolveTargets } from "./target.ts";

/** Output bound per stream, an implementation constant, not model-controlled (spec 9.6). */
const MAX_OUTPUT_CHARS = 100_000;

export type CheckResult = {
	check: string;
	targets: string[];
	exitCode: number | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
	truncated: boolean;
	durationMs: number;
};

function capture(stream: NodeJS.ReadableStream): {
	text: string;
	truncated: () => boolean;
} {
	let text = "";
	let overflow = false;
	stream.on("data", (chunk: Buffer) => {
		if (text.length < MAX_OUTPUT_CHARS) text += chunk.toString("utf8");
		else overflow = true;
	});
	return {
		get text() {
			return text;
		},
		truncated: () => overflow,
	};
}

/**
 * Runs a named check (C5): validated targets go through the verified adapter,
 * then the fixed executable is spawned without a shell. Timeout kills the child
 * and returns timedOut; abort rejects; nonzero exit is returned, not thrown.
 * `cwd` is the session cwd used to resolve the trusted check.cwd.
 */
export async function runCheck(
	check: ValidationCheck,
	targets: string[],
	signal: AbortSignal | undefined,
	cwd: string = process.cwd(),
): Promise<CheckResult> {
	let suffix: string[] = [];
	if (targets.length > 0) {
		const validated = resolveTargets(check, targets, cwd);
		const adapter = resolveAdapter(check);
		if (!adapter)
			throw new ToolError(
				"INVALID_ARGUMENT",
				"check does not support targets; call it without targets",
			);
		suffix = adapter(check, validated);
	}
	return new Promise<CheckResult>((resolve, reject) => {
		const checkCwd = path.resolve(cwd, check.cwd);
		// A leaked NODE_TEST_CONTEXT switches the nested `node --test` to IPC
		// reporting and swallows stdio; the named check runs clean instead.
		const env = { ...process.env };
		delete env.NODE_TEST_CONTEXT;
		const started = Date.now();
		const child = spawn(check.program, [...check.args, ...suffix], {
			cwd: checkCwd,
			env,
			shell: false,
			signal,
		});
		const out = capture(child.stdout);
		const err = capture(child.stderr);
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, check.timeoutMs);
		child.on("error", (e) => {
			clearTimeout(timer);
			reject(e);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({
				// The configured check name is known to the tool layer; it overwrites this.
				check: check.program,
				targets,
				exitCode: code,
				timedOut,
				stdout: out.text,
				stderr: err.text,
				truncated: out.truncated() || err.truncated(),
				durationMs: Date.now() - started,
			});
		});
	});
}
