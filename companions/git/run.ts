import { ToolError } from "../../src/errors.ts";
import {
	type ExecFixedOptions,
	execFixed,
	type FixedOutcome,
} from "../process.ts";

/** Runs git with fixed argv; a non-zero exit is GIT_FAILED, not a throw path. */
export async function runGit(
	args: string[],
	cwd: string,
	what: string,
	opts: ExecFixedOptions = {},
): Promise<FixedOutcome> {
	const out = await execFixed("git", args, cwd, opts);
	if (out.code !== 0) {
		throw new ToolError("GIT_FAILED", `${what} failed: ${out.stderr}`);
	}
	return out;
}
