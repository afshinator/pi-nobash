import childProcess, { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type SpawnRecord = { program: string; args: string[] };

/** Repository root, resolved from this file's location (tests/helpers/). */
export const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * Patches child_process.spawn (via the patchable default-import object, the
 * same access form companions/process.ts uses) to record every spawned
 * program. Returns the recorder and a restore function.
 */
export function recordSpawns(): {
	spawns: SpawnRecord[];
	restore: () => void;
} {
	const spawns: SpawnRecord[] = [];
	const simple = childProcess.spawn as (
		p: string,
		a: string[],
		o?: object,
	) => childProcess.ChildProcess;
	const orig = childProcess.spawn;
	(childProcess as { spawn: unknown }).spawn = (
		program: string,
		args: string[],
		opts?: object,
	) => {
		spawns.push({ program, args });
		return simple(program, args, opts);
	};
	return {
		spawns,
		restore: () => {
			(childProcess as { spawn: unknown }).spawn = orig;
		},
	};
}

/** Disposable git repo on a branch, one initial commit, user config set. */
export function createTempGitRepo(options?: { initialBranch?: string }): {
	dir: string;
	cleanup: () => void;
} {
	const dir = mkdtempSync(path.join(tmpdir(), "pi-nobash-git-"));
	const git = (args: string[]) =>
		execFileSync("git", args, { cwd: dir, stdio: "pipe" });
	const branch = options?.initialBranch ?? "main";
	git(["init", "-b", branch]);
	git(["config", "user.email", "test@example.com"]);
	git(["config", "user.name", "Test"]);
	writeFileSync(path.join(dir, "README.md"), "initial\n");
	mkdirSync(path.join(dir, "src"), { recursive: true });
	writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
	git(["add", "."]);
	git(["commit", "-m", "initial"]);
	return {
		dir,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

/** Throwaway bare repo to serve as a push remote. */
export function createBareRemote(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(path.join(tmpdir(), "pi-nobash-remote-"));
	execFileSync("git", ["init", "--bare", dir], { stdio: "pipe" });
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Runs a git command in a directory and returns stdout (throws on failure). */
export function gitIn(dir: string, args: string[]): string {
	return execFileSync("git", args, { cwd: dir, stdio: "pipe" })
		.toString()
		.trim();
}
