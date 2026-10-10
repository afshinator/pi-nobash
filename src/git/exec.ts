import { spawn } from "node:child_process";

/** Accumulation cap per stream: appending stops past it (memory bound, spec 9.6). */
export const MAX_GIT_STREAM_BYTES = 100_000;

/** Fixed-executable git executor: no shell, fixed argv, no model flags. */
export type GitOutcome = {
	code: number;
	stdout: string;
	stderr: string;
	truncated: boolean;
};

export function execGit(
	args: string[],
	cwd: string,
	signal?: AbortSignal,
): Promise<GitOutcome> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", args, { cwd, shell: false, signal });
		let stdout = "";
		let stderr = "";
		let truncated = false;
		const capture = (
			stream: NodeJS.ReadableStream,
			sink: () => string,
			append: (s: string) => void,
		) => {
			stream.on("data", (c: Buffer) => {
				const room = MAX_GIT_STREAM_BYTES - sink().length;
				if (room <= 0) {
					truncated = true;
					return;
				}
				const text = c.toString("utf8");
				if (text.length <= room) {
					append(text);
				} else {
					// Keep only the headroom; a split char is fine for display text.
					append(text.slice(0, room));
					truncated = true;
				}
			});
		};
		capture(
			child.stdout,
			() => stdout,
			(s) => {
				stdout += s;
			},
		);
		capture(
			child.stderr,
			() => stderr,
			(s) => {
				stderr += s;
			},
		);
		child.on("error", reject);
		child.on("close", (code) =>
			resolve({ code: code ?? -1, stdout, stderr, truncated }),
		);
	});
}
