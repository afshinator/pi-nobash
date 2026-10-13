import childProcess from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { truncateUtf8 } from "../src/errors.ts";
import { MAX_GIT_STREAM_BYTES } from "../src/git/exec.ts";

/**
 * Bounded fixed-argv runner for companion tools, modeled on src/git/exec.ts.
 * Default-import property access (not `import { spawn }`) so tests can
 * intercept spawns; the named import is a snapshot and cannot be patched.
 *
 * Byte-accurate caps: core src/git/exec.ts counts characters; here the
 * per-stream cap is UTF-8 bytes, never splitting a character.
 */
export type ExecFixedOptions = {
	env?: Record<string, string> | undefined;
	timeoutMs?: number | undefined;
	signal?: AbortSignal | undefined;
};

export type FixedOutcome = {
	code: number;
	stdout: string;
	stderr: string;
	truncated: boolean;
	timedOut: boolean;
};

export function execFixed(
	program: string,
	args: string[],
	cwd: string,
	opts: ExecFixedOptions = {},
): Promise<FixedOutcome> {
	return new Promise((resolve, reject) => {
		const timeoutSignal =
			opts.timeoutMs !== undefined
				? AbortSignal.timeout(opts.timeoutMs)
				: undefined;
		const signal =
			opts.signal && timeoutSignal
				? AbortSignal.any([opts.signal, timeoutSignal])
				: (opts.signal ?? timeoutSignal);
		const child = childProcess.spawn(program, args, {
			cwd,
			shell: false,
			...(opts.env !== undefined
				? { env: { ...process.env, ...opts.env } }
				: {}),
			...(signal !== undefined ? { signal } : {}),
		});
		let stdout = "";
		let stderr = "";
		let truncated = false;
		// Escalate to SIGKILL: spawn's signal option only sends SIGTERM, which a
		// trapping child can ignore forever.
		const kill = () => {
			try {
				child.kill("SIGKILL");
			} catch {
				// already exited
			}
		};
		const onTimeout = () => kill();
		const onCallerAbort = () => kill();
		timeoutSignal?.addEventListener("abort", onTimeout, { once: true });
		opts.signal?.addEventListener("abort", onCallerAbort, { once: true });
		const capture = (
			stream: NodeJS.ReadableStream,
			append: (s: string) => void,
		) => {
			// StringDecoder holds back partial multi-byte chars at chunk edges;
			// truncateUtf8 then trims to the byte room on whole code points.
			const decoder = new StringDecoder("utf8");
			let bytes = 0;
			stream.on("data", (c: Buffer) => {
				if (bytes >= MAX_GIT_STREAM_BYTES) {
					truncated = true;
					return;
				}
				const text = decoder.write(c);
				const room = MAX_GIT_STREAM_BYTES - bytes;
				const size = Buffer.byteLength(text, "utf8");
				if (size <= room) {
					append(text);
					bytes += size;
				} else {
					const head = truncateUtf8(text, room);
					append(head.text);
					bytes += Buffer.byteLength(head.text, "utf8");
					truncated = true;
				}
			});
		};
		capture(child.stdout, (s) => {
			stdout += s;
		});
		capture(child.stderr, (s) => {
			stderr += s;
		});
		child.on("error", (err) => {
			// An abort (timeout or caller signal) emits AbortError here; close still
			// fires and resolves with timedOut, so only real spawn errors reject.
			if (!signal?.aborted) reject(err);
		});
		child.on("close", (code) => {
			timeoutSignal?.removeEventListener("abort", onTimeout);
			opts.signal?.removeEventListener("abort", onCallerAbort);
			resolve({
				code: code ?? -1,
				stdout,
				stderr,
				truncated,
				timedOut: timeoutSignal?.aborted ?? false,
			});
		});
	});
}
