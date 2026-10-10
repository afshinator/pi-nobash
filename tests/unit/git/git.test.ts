import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { MAX_GIT_PATHS } from "../../../src/constants.ts";
import { execGit } from "../../../src/git/exec.ts";
import {
	gitDiffTool,
	gitLogTool,
	gitShowTool,
	gitStatusTool,
} from "../../../src/git/index.ts";
import { gitDiff, gitLog, gitShow, gitStatus } from "../../../src/git/tools.ts";

const dirs: string[] = [];
function git(dir: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

function makeRepo(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "pi-nobash-git-"));
	dirs.push(dir);
	git(dir, "init", "-q");
	git(dir, "config", "user.email", "test@example.com");
	git(dir, "config", "user.name", "Test");
	git(dir, "config", "commit.gpgsign", "false");
	writeFileSync(path.join(dir, "a.txt"), "one\n");
	git(dir, "add", "a.txt");
	git(dir, "commit", "-q", "-m", "first commit", "--no-verify");
	return dir;
}

function envelope(result: {
	content: unknown;
	details: unknown;
	isError?: boolean;
}) {
	const content = result.content as Array<{ text?: string }>;
	return {
		isError: result.isError === true,
		text: content[0]?.text ?? "",
		details: result.details as { code?: string; message?: string },
	};
}

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("git_status: normalized branch/head/entries with index and worktree columns", async () => {
	const repo = makeRepo();
	writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
	writeFileSync(path.join(repo, "staged.txt"), "new\n");
	git(repo, "add", "staged.txt");
	writeFileSync(path.join(repo, "untracked.txt"), "u\n");

	const out = envelope(await gitStatus({}, undefined, repo));
	assert.equal(out.isError, false);
	const d = out.details as {
		branch: string | null;
		head: string | null;
		detached: boolean;
		entries: Array<{ path: string; index: string; worktree: string }>;
	};
	assert.equal(d.branch, git(repo, "symbolic-ref", "--short", "HEAD").trim());
	assert.equal(
		d.head,
		execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: repo,
			encoding: "utf8",
		}).trim(),
	);
	assert.equal(d.detached, false);
	const a = d.entries.find((e) => e.path === "a.txt");
	assert.ok(a);
	assert.equal(a.index, " ");
	assert.equal(a.worktree, "M");
	const staged = d.entries.find((e) => e.path === "staged.txt");
	assert.ok(staged);
	assert.equal(staged.index, "A");
	assert.ok(
		d.entries.some((e) => e.path === "untracked.txt" && e.index === "?"),
	);
});

test("git_status: includeUntracked=false drops untracked, rename carries originalPath", async () => {
	const repo = makeRepo();
	git(repo, "mv", "a.txt", "b.txt");
	const out = envelope(
		await gitStatus({ includeUntracked: false }, undefined, repo),
	);
	const d = out.details as {
		entries: Array<{
			path: string;
			originalPath?: string;
			index: string;
			worktree: string;
		}>;
	};
	const renamed = d.entries.find((e) => e.path === "b.txt");
	assert.ok(renamed);
	assert.equal(renamed.index, "R");
	assert.equal(renamed.originalPath, "a.txt");
});

test("git_status: detached HEAD reports branch null", async () => {
	const repo = makeRepo();
	const sha = git(repo, "rev-parse", "HEAD").trim();
	git(repo, "checkout", "-q", "--detach", sha);
	const out = envelope(await gitStatus({}, undefined, repo));
	const d = out.details as { branch: string | null; detached: boolean };
	assert.equal(d.detached, true);
	assert.equal(d.branch, null);
});

test("git_diff: working excludes staged; staged includes it; commit diffs from revision", async () => {
	const repo = makeRepo();
	const firstSha = git(repo, "rev-parse", "HEAD").trim();
	writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
	git(repo, "add", "a.txt");

	const working = envelope(await gitDiff({ mode: "working" }, undefined, repo));
	const workingD = working.details as {
		mode: string;
		filesChanged: number;
		truncated: boolean;
		diff: string;
	};
	assert.equal(workingD.mode, "working");
	assert.equal(
		workingD.filesChanged,
		0,
		"staged change is invisible to working diff",
	);
	assert.equal(workingD.truncated, false);

	const staged = envelope(await gitDiff({ mode: "staged" }, undefined, repo));
	const stagedD = staged.details as {
		mode: string;
		filesChanged: number;
		diff: string;
		contextLines: number;
	};
	assert.equal(stagedD.mode, "staged");
	assert.equal(stagedD.filesChanged, 1);
	assert.match(stagedD.diff, /\+two/);
	assert.equal(stagedD.contextLines, 3);

	writeFileSync(path.join(repo, "a.txt"), "one\nTWO\n");
	const commit = envelope(
		await gitDiff({ mode: "commit", revision: firstSha }, undefined, repo),
	);
	const commitD = commit.details as {
		mode: string;
		revision?: string;
		filesChanged: number;
	};
	assert.equal(commitD.mode, "commit");
	assert.equal(commitD.revision, firstSha);
	assert.equal(
		commitD.filesChanged,
		1,
		"commit diff covers staged + worktree since revision",
	);
});

test("git_diff: bounded contextLines; revision only with commit mode", async () => {
	const repo = makeRepo();
	const bad = envelope(
		await gitDiff({ mode: "staged", revision: "HEAD" }, undefined, repo),
	);
	assert.equal(bad.isError, true);
	assert.equal(bad.details.code, "INVALID_ARGUMENT");
	const missing = envelope(await gitDiff({ mode: "commit" }, undefined, repo));
	assert.equal(missing.isError, true);
	assert.equal(missing.details.code, "INVALID_ARGUMENT");
	const bounded = envelope(
		await gitDiff({ mode: "working", contextLines: 200 }, undefined, repo),
	);
	assert.equal(bounded.details.code, "LIMIT_EXCEEDED");
});

test("git_log: fixed fields, maxEntries bound, truncated when more exist", async () => {
	const repo = makeRepo();
	writeFileSync(path.join(repo, "a.txt"), "change\n");
	git(repo, "add", "a.txt");
	git(repo, "commit", "-q", "-m", "second commit", "--no-verify");

	const out = envelope(await gitLog({}, undefined, repo));
	const d = out.details as {
		entries: Array<{
			hash: string;
			shortHash: string;
			author: string;
			authorEmail: string;
			timestamp: string;
			subject: string;
		}>;
		truncated: boolean;
	};
	assert.equal(d.entries.length, 2);
	assert.equal(d.truncated, false);
	const first = d.entries[0];
	assert.ok(first);
	assert.match(first.hash, /^[0-9a-f]{40}$/);
	assert.equal(first.subject, "second commit");
	assert.equal(first.author, "Test");
	assert.equal(first.authorEmail, "test@example.com");
	assert.ok(!Number.isNaN(Date.parse(first.timestamp)));

	const one = envelope(await gitLog({ maxEntries: 1 }, undefined, repo));
	const oneD = one.details as { entries: unknown[]; truncated: boolean };
	assert.equal(oneD.entries.length, 1);
	assert.equal(oneD.truncated, true);

	const over = envelope(await gitLog({ maxEntries: 500 }, undefined, repo));
	assert.equal(over.details.code, "LIMIT_EXCEEDED");
});

test("git_show: revision, hash, author, timestamp, subject, body, diff", async () => {
	const repo = makeRepo();
	const sha = git(repo, "rev-parse", "HEAD").trim();
	const out = envelope(await gitShow({ revision: "HEAD" }, undefined, repo));
	assert.equal(out.isError, false);
	const d = out.details as {
		revision: string;
		hash: string;
		author: string;
		timestamp: string;
		subject: string;
		body: string;
		diff: string;
		truncated: boolean;
	};
	assert.equal(d.revision, "HEAD");
	assert.equal(d.hash, sha);
	assert.equal(d.author, "Test");
	assert.ok(!Number.isNaN(Date.parse(d.timestamp)));
	assert.equal(d.subject, "first commit");
	assert.equal(d.truncated, false);
});

test("git_show: option-like and malformed revisions are rejected before git runs", async () => {
	const repo = makeRepo();
	for (const rev of ["-n1", "a..b", "HEAD@{1}", "bad rev", "x;rm", "a\0b"]) {
		const out = envelope(await gitShow({ revision: rev }, undefined, repo));
		assert.equal(out.isError, true, `revision ${JSON.stringify(rev)}`);
		assert.equal(
			out.details.code,
			"INVALID_ARGUMENT",
			`revision ${JSON.stringify(rev)}`,
		);
	}
});

test("git_show: valid-charset revision that is not a commit is NOT_FOUND", async () => {
	const repo = makeRepo();
	const out = envelope(
		await gitShow({ revision: "deadbeef" }, undefined, repo),
	);
	assert.equal(out.isError, true);
	assert.equal(out.details.code, "NOT_FOUND");
});

test("git paths: flag-like final segment is rejected; missing path is NOT_FOUND", async () => {
	const repo = makeRepo();
	mkdirSync(path.join(repo, "sub"));
	writeFileSync(path.join(repo, "sub", "-x.txt"), "n\n");

	for (const run of [
		() => gitDiff({ mode: "working", paths: ["sub/-x.txt"] }, undefined, repo),
		() => gitLog({ paths: ["sub/-x.txt"] }, undefined, repo),
		() => gitShow({ revision: "HEAD", paths: ["sub/-x.txt"] }, undefined, repo),
		() => gitStatus({ paths: ["sub/-x.txt"] }, undefined, repo),
	]) {
		const out = envelope(await run());
		assert.equal(out.isError, true);
		assert.equal(out.details.code, "INVALID_ARGUMENT");
	}

	const missing = envelope(
		await gitShow({ revision: "HEAD", paths: ["nope.txt"] }, undefined, repo),
	);
	assert.equal(missing.isError, true);
	assert.equal(missing.details.code, "NOT_FOUND");
});

test("git tools: error envelopes carry the <CODE>: text prefix (C3)", async () => {
	const repo = makeRepo();
	const out = envelope(await gitShow({ revision: "-n1" }, undefined, repo));
	assert.ok(out.text.startsWith("INVALID_ARGUMENT: "));
	assert.equal(out.details.code, "INVALID_ARGUMENT");
});

test("git_status: oversized status output is a visible LIMIT_EXCEEDED, not a silent partial list", async () => {
	const repo = makeRepo();
	// ~600 long-named untracked files push `status --porcelain -z` past the 100KB exec cap.
	const longName = "u".repeat(200);
	for (let i = 0; i < 600; i += 1) {
		writeFileSync(path.join(repo, `${longName}-${i}.txt`), "x\n");
	}
	const out = envelope(await gitStatus({}, undefined, repo));
	assert.equal(out.isError, true);
	assert.equal(out.details.code, "LIMIT_EXCEEDED");
});

test("git exec: accumulated stdout is bounded and truncation is surfaced", async () => {
	const repo = makeRepo();
	// ~300KB file dwarfs the 100KB exec cap; commit it so show sees it.
	const big = Array.from(
		{ length: 6_000 },
		(_, i) => `line ${i} pad ${"x".repeat(40)}`,
	);
	writeFileSync(path.join(repo, "big.txt"), `${big.join("\n")}\n`);
	git(repo, "add", "big.txt");
	git(repo, "commit", "-q", "-m", "big file", "--no-verify");

	// exec-level contract: accumulation stops at the cap, truncation is reported.
	const out = await execGit(["show", "HEAD"], repo);
	assert.equal(out.truncated, true, "execGit must report truncation");
	assert.ok(
		out.stdout.length <= 100_000,
		"accumulated stdout must stay under the cap",
	);

	// tool-level: the exec truncation reaches the C4 details.
	const show = envelope(await gitShow({ revision: "HEAD" }, undefined, repo));
	assert.equal(show.isError, false);
	const showD = show.details as { truncated: boolean; diff: string };
	assert.equal(showD.truncated, true, "show must surface truncation");
});

// N5: one source of truth for the git path cap (spec 9.6): the TypeBox schema
// is the effective gate for model-supplied paths, so it must equal MAX_GIT_PATHS.
test("git tool schemas cap paths at MAX_GIT_PATHS = 100 (spec 9.6)", () => {
	assert.equal(MAX_GIT_PATHS, 100);
	for (const tool of [gitStatusTool, gitDiffTool, gitLogTool, gitShowTool]) {
		const paths = (
			tool.parameters as { properties: { paths: { maxItems?: number } } }
		).properties.paths;
		assert.equal(
			paths.maxItems,
			MAX_GIT_PATHS,
			`${tool.name} paths.maxItems must be MAX_GIT_PATHS`,
		);
	}
});
