import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	buildRmCachedArgv,
	rmCachedTool,
	validateRmCachedPaths,
} from "../../../companions/git/rm-cached.ts";

function codeOf(fn: () => unknown): string {
	try {
		fn();
	} catch (e) {
		return (e as { code?: string }).code ?? "";
	}
	return "OK";
}

test("buildRmCachedArgv is exactly git rm -r --cached -- <paths>", () => {
	assert.deepEqual(buildRmCachedArgv(["a.txt", "dir/b.txt"]), [
		"rm",
		"-r",
		"--cached",
		"--",
		"a.txt",
		"dir/b.txt",
	]);
});

test("validateRmCachedPaths passes through safe relative paths", () => {
	const cwd = mkdtempSync(path.join(tmpdir(), "rm-cached-ok-"));
	try {
		writeFileSync(path.join(cwd, "a.txt"), "a\n");
		assert.deepEqual(validateRmCachedPaths(["a.txt", "src/b.ts"], cwd), [
			"a.txt",
			"src/b.ts",
		]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("validateRmCachedPaths rejects traversal, absolute, NUL, option-like segments (INVALID_ARGUMENT)", () => {
	const cwd = mkdtempSync(path.join(tmpdir(), "rm-cached-scope-"));
	try {
		for (const p of ["../x", "/etc/passwd", "a\0b", "dir/-flag"]) {
			assert.equal(
				codeOf(() => validateRmCachedPaths([p], cwd)),
				"INVALID_ARGUMENT",
				p,
			);
		}
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("validateRmCachedPaths rejects leading-: pathspec magic (INVALID_ARGUMENT)", () => {
	const cwd = mkdtempSync(path.join(tmpdir(), "rm-cached-magic-"));
	try {
		for (const p of [":(glob)x", ":!secret", ":(top)y", ":/z"]) {
			assert.equal(
				codeOf(() => validateRmCachedPaths([p], cwd)),
				"INVALID_ARGUMENT",
				p,
			);
		}
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("validateRmCachedPaths: '.', -A/--force flags, and globs are CAPABILITY_GAP", () => {
	const cwd = mkdtempSync(path.join(tmpdir(), "rm-cached-cap-"));
	try {
		for (const p of [
			".",
			"./",
			"-A",
			"--all",
			"--force",
			"-f",
			"*.ts",
			"dir/?.txt",
			"a[0]",
		]) {
			assert.equal(
				codeOf(() => validateRmCachedPaths([p], cwd)),
				"CAPABILITY_GAP",
				p,
			);
		}
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("validateRmCachedPaths rejects symlink escape (PATH_OUT_OF_SCOPE)", () => {
	const outside = mkdtempSync(path.join(tmpdir(), "rm-cached-out-"));
	const cwd = mkdtempSync(path.join(tmpdir(), "rm-cached-link-"));
	try {
		writeFileSync(path.join(outside, "secret.txt"), "s\n");
		symlinkSync(outside, path.join(cwd, "link"));
		assert.equal(
			codeOf(() => validateRmCachedPaths(["link/secret.txt"], cwd)),
			"PATH_OUT_OF_SCOPE",
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("validateRmCachedPaths: 101 paths is LIMIT_EXCEEDED", () => {
	const cwd = mkdtempSync(path.join(tmpdir(), "rm-cached-cap2-"));
	try {
		const paths = Array.from({ length: 101 }, (_, i) => `f${i}.txt`);
		assert.equal(
			codeOf(() => validateRmCachedPaths(paths, cwd)),
			"LIMIT_EXCEEDED",
		);
		assert.deepEqual(
			validateRmCachedPaths(paths.slice(0, 100), cwd),
			paths.slice(0, 100),
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("rmCachedTool metadata: direct exposure, off by default, destructive, no flag fields", () => {
	assert.equal(rmCachedTool.name, "git_rm_cached");
	assert.equal(rmCachedTool.exposure, "direct");
	assert.equal(rmCachedTool.defaultActive, false);
	assert.equal(rmCachedTool.annotations?.readOnlyHint, false);
	assert.equal(rmCachedTool.annotations?.destructiveHint, true);
	assert.equal(typeof rmCachedTool.promptSnippet, "string");
	assert.ok((rmCachedTool.promptSnippet ?? "").length > 0);
	const raw = JSON.stringify(rmCachedTool.parameters);
	for (const banned of ["command", "argv", "script", "flag", "force", "all"]) {
		assert.ok(!raw.includes(`"${banned}"`), `schema leaks "${banned}"`);
	}
});

test("executeRmCached: any key other than paths is CAPABILITY_GAP (force/flag/all form)", async () => {
	const { executeRmCached } = await import(
		"../../../companions/git/rm-cached.ts"
	);
	for (const extra of [
		{ force: true },
		{ all: true },
		{ flags: ["-A"] },
		{ recursive: true },
	]) {
		const r = (await executeRmCached(
			{ ...extra, paths: ["README.md"] } as never,
			undefined,
			process.cwd(),
		)) as { details?: { code?: string } };
		assert.equal(r.details?.code, "CAPABILITY_GAP", JSON.stringify(extra));
	}
});
