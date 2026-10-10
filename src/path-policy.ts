import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { type ErrorCode, ToolError } from "./errors.ts";

/** Path-policy failure; carries a C3 error code via the shared ToolError. */
export class PathPolicyError extends ToolError {
	constructor(code: ErrorCode, message: string) {
		super(code, message);
		this.name = "PathPolicyError";
	}
}

function resolveRealPath(abs: string): string {
	if (existsSync(abs)) return realpathSync(abs);
	let ancestor = abs;
	const tail: string[] = [];
	while (!existsSync(ancestor)) {
		const parent = path.dirname(ancestor);
		if (parent === ancestor) {
			throw new PathPolicyError("NOT_FOUND", `no existing ancestor for ${abs}`);
		}
		tail.unshift(path.basename(ancestor));
		ancestor = parent;
	}
	return path.join(realpathSync(ancestor), ...tail);
}

function assertContained(
	realCwd: string,
	real: string,
	original: string,
): void {
	const rel = path.relative(realCwd, real);
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new PathPolicyError(
			"PATH_OUT_OF_SCOPE",
			`path escapes workspace: ${original}`,
		);
	}
}

/**
 * Resolves `requestPath` against `cwd`, normalizes `.`/`..`, rejects NUL and
 * escape (including symlink escape) per spec §18. Returns the lexical absolute path.
 */
export function validateWorkspacePath(
	cwd: string,
	requestPath: string,
): string {
	if (requestPath.includes("\0")) {
		throw new PathPolicyError("INVALID_ARGUMENT", "path contains a null byte");
	}
	const absCwd = path.resolve(cwd);
	const abs = path.resolve(absCwd, requestPath);
	const realCwd = resolveRealPath(absCwd);
	const real = resolveRealPath(abs);
	if (path.relative(realCwd, real) === "") return abs;
	assertContained(realCwd, real, requestPath);
	return abs;
}

/** Workspace path that must exist as a regular file. */
export function validateWorkspaceFile(
	cwd: string,
	requestPath: string,
): string {
	const abs = validateWorkspacePath(cwd, requestPath);
	if (!existsSync(abs)) {
		throw new PathPolicyError("NOT_FOUND", `file not found: ${requestPath}`);
	}
	if (!statSync(abs).isFile()) {
		throw new PathPolicyError(
			"INVALID_ARGUMENT",
			`not a regular file: ${requestPath}`,
		);
	}
	return abs;
}

/**
 * Validates a Git repository-relative path for direct argv placement (no `--`).
 * Rejects absolute paths, `..` traversal, NUL, and option-like final segments.
 */
export function assertSafeRelativeGitPath(p: string): string {
	if (typeof p !== "string" || p.length === 0) {
		throw new PathPolicyError(
			"INVALID_ARGUMENT",
			"path must be a non-empty string",
		);
	}
	if (p.includes("\0")) {
		throw new PathPolicyError("INVALID_ARGUMENT", "path contains a null byte");
	}
	if (path.isAbsolute(p)) {
		throw new PathPolicyError(
			"INVALID_ARGUMENT",
			"absolute paths are not allowed",
		);
	}
	const segments = p.split("/");
	if (segments.includes("..")) {
		throw new PathPolicyError(
			"INVALID_ARGUMENT",
			"path traversal is not allowed",
		);
	}
	const final = segments[segments.length - 1];
	if (final?.startsWith("-")) {
		throw new PathPolicyError(
			"INVALID_ARGUMENT",
			"option-like path segment is not allowed",
		);
	}
	return p;
}

/** Validates a bounded list of Git paths. */
export function validateGitPaths(paths: string[], max: number): string[] {
	if (paths.length > max) {
		throw new PathPolicyError(
			"INVALID_ARGUMENT",
			`too many paths (max ${max})`,
		);
	}
	return paths.map((p) => assertSafeRelativeGitPath(p));
}
