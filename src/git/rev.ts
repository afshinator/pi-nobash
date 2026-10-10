import { realpathSync } from "node:fs";
import path from "node:path";
import { ToolError } from "../errors.ts";
import { execGit } from "./exec.ts";

const REVISION_RE = /^[A-Za-z0-9._/@^~-]+$/;

/**
 * A6 revision rule: charset/shape check, then `git rev-parse --verify --quiet
 * <rev>^{commit}` must succeed. Never placed after `--`.
 */
export async function validateCommitRevision(
	revision: unknown,
	cwd: string,
): Promise<string> {
	if (
		typeof revision !== "string" ||
		revision.length === 0 ||
		revision.length > 255
	)
		throw new ToolError(
			"INVALID_ARGUMENT",
			"revision must be a non-empty string of at most 255 characters",
		);
	if (
		/\s/.test(revision) ||
		revision.startsWith("-") ||
		revision.includes("..") ||
		revision.includes("@{")
	)
		throw new ToolError(
			"INVALID_ARGUMENT",
			`revision is not a plain commit reference: ${revision}`,
		);
	if (!REVISION_RE.test(revision))
		throw new ToolError(
			"INVALID_ARGUMENT",
			`revision contains forbidden characters: ${revision}`,
		);
	const out = await execGit(
		["rev-parse", "--verify", "--quiet", `${revision}^{commit}`],
		cwd,
	);
	if (out.code !== 0)
		throw new ToolError(
			"NOT_FOUND",
			`revision does not resolve to a commit: ${revision}`,
		);
	return out.stdout.trim();
}

/** Model paths: no option-like final segment; must exist; never passed after `--`. */
export function validateModelPaths(
	paths: string[] | undefined,
	cwd: string,
): string[] {
	if (!paths || paths.length === 0) return [];
	for (const p of paths) {
		if (typeof p !== "string" || p.length === 0 || p.includes("\0"))
			throw new ToolError(
				"INVALID_ARGUMENT",
				"each path must be a non-empty string",
			);
		if (path.basename(p).startsWith("-"))
			throw new ToolError(
				"INVALID_ARGUMENT",
				`path must not look like an option: ${p}`,
			);
		try {
			realpathSync(path.resolve(cwd, p));
		} catch {
			throw new ToolError("NOT_FOUND", `path does not exist: ${p}`);
		}
	}
	return paths;
}
