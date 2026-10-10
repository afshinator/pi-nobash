import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { ValidationCheck } from "../config.ts";
import { ToolError } from "../errors.ts";

type TargetFileSpec = Extract<ValidationCheck["targets"], { mode: "file" }>;

export const MAX_TARGETS = 50;

function isContained(realFile: string, realRoot: string): boolean {
	return realFile === realRoot || realFile.startsWith(realRoot + path.sep);
}

function isApprovedScope(
	absolute: string,
	spec: TargetFileSpec,
	cwd: string,
): boolean {
	const lexicallyInRoot = spec.roots.some((root) =>
		isContained(absolute, path.resolve(cwd, root)),
	);
	return (
		lexicallyInRoot ||
		(spec.exact ?? []).some((exact) => absolute === path.resolve(cwd, exact))
	);
}

function isRealScope(
	realFile: string,
	realRoots: string[],
	realExact: Set<string>,
): boolean {
	return (
		realRoots.some((root) => isContained(realFile, root)) ||
		realExact.has(realFile)
	);
}

function validateTarget(
	spec: TargetFileSpec,
	realCwd: string,
	realRoots: string[],
	realExact: Set<string>,
	cwd: string,
): (target: string) => string {
	return (target) => {
		if (
			typeof target !== "string" ||
			target.length === 0 ||
			target.includes("\0")
		)
			throw new ToolError(
				"INVALID_ARGUMENT",
				"each target must be a non-empty path string",
			);
		if (path.basename(target).startsWith("-"))
			throw new ToolError(
				"INVALID_ARGUMENT",
				`target must not look like an option: ${target}`,
			);

		const absolute = path.resolve(cwd, target);
		// Lexical scope first so traversal is rejected even before existence.
		if (!isApprovedScope(absolute, spec, cwd))
			throw new ToolError(
				"PATH_OUT_OF_SCOPE",
				`target is outside the approved roots: ${target}`,
			);
		let realFile: string;
		try {
			realFile = realpathSync(absolute);
		} catch {
			throw new ToolError(
				"INVALID_ARGUMENT",
				`target does not exist: ${target}`,
			);
		}
		if (!statSync(realFile).isFile())
			throw new ToolError(
				"INVALID_ARGUMENT",
				`target must be a regular file: ${target}`,
			);
		// Symlink-resolved containment (spec 18.3).
		if (!isRealScope(realFile, realRoots, realExact))
			throw new ToolError(
				"PATH_OUT_OF_SCOPE",
				`target is outside the approved roots: ${target}`,
			);

		if (
			spec.extensions !== undefined &&
			!spec.extensions.some((ext) => realFile.endsWith(ext))
		)
			throw new ToolError(
				"INVALID_ARGUMENT",
				`target extension is not approved: ${target}`,
			);

		return path.relative(realCwd, realFile);
	};
}

/**
 * Validates model-supplied targets against a file-mode check (spec 14.5, 18.3):
 * existing regular files, inside an allowed root (symlink-resolved) or in the
 * exact list, extension rules, no option-like names, at most MAX_TARGETS.
 * Returns cwd-relative paths suitable for the runner adapter.
 */
export function resolveTargets(
	check: ValidationCheck,
	targets: string[],
	cwd: string = process.cwd(),
): string[] {
	const spec = check.targets;
	if (spec.mode !== "file")
		throw new ToolError(
			"INVALID_ARGUMENT",
			'check does not permit targets (targets.mode is "none")',
		);
	if (targets.length === 0)
		throw new ToolError("INVALID_ARGUMENT", "targets array must not be empty");
	if (targets.length > MAX_TARGETS)
		throw new ToolError(
			"LIMIT_EXCEEDED",
			`too many targets: ${targets.length} > ${MAX_TARGETS}`,
		);

	const realCwd = realpathSync(cwd);
	const realRoots = spec.roots.map((root) =>
		realpathSync(path.resolve(cwd, root)),
	);
	const realExact = new Set(
		(spec.exact ?? []).map((exact) => realpathSync(path.resolve(cwd, exact))),
	);

	return targets.map(validateTarget(spec, realCwd, realRoots, realExact, cwd));
}
