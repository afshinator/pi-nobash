import assert from "node:assert/strict";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { executeAdd } from "../../companions/git/add.ts";
import { executeCommit } from "../../companions/git/commit.ts";
import { executeCreateBranch } from "../../companions/git/create-branch.ts";
import { executePush } from "../../companions/git/push.ts";
import { executeRmCached } from "../../companions/git/rm-cached.ts";
import {
	createBareRemote,
	createTempGitRepo,
	gitIn,
} from "../helpers/companion-harness.ts";

/** Frozen error code of an executed tool body: from the returned envelope, or a thrown error. */
async function errCode(fn: () => Promise<unknown>): Promise<string> {
	try {
		const r = (await fn()) as { details?: { code?: string } };
		return r.details?.code ?? "OK";
	} catch (e) {
		return (e as { code?: string }).code ?? "";
	}
}

async function unwrap(p: Promise<unknown>): Promise<unknown> {
	return p;
}

let repo: string;
let remote: string;
let cleanupRepo: () => void;
let cleanupRemote: () => void;

before(() => {
	const r = createTempGitRepo();
	repo = r.dir;
	cleanupRepo = r.cleanup;
	const b = createBareRemote();
	remote = b.dir;
	cleanupRemote = b.cleanup;
	gitIn(repo, ["remote", "add", "origin", remote]);
});

after(() => {
	cleanupRepo();
	cleanupRemote();
});

const commitFile = (rel: string, content: string) => {
	mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
	writeFileSync(path.join(repo, rel), content);
};

const remoteTip = (branch = "main") =>
	gitIn(remote, ["rev-parse", `refs/heads/${branch}`]);

test("git_create_branch: create+switch, create-only, from startPoint", async () => {
	const switched = (await unwrap(
		executeCreateBranch({ name: "topic" }, undefined, repo),
	)) as { details: { branch: string; switchedTo: boolean } };
	assert.equal(switched.details.branch, "topic");
	assert.equal(switched.details.switchedTo, true);
	assert.equal(gitIn(repo, ["rev-parse", "--abbrev-ref", "HEAD"]), "topic");

	await unwrap(
		executeCreateBranch({ name: "parked", switchTo: false }, undefined, repo),
	);
	assert.ok(gitIn(repo, ["rev-parse", "--verify", "refs/heads/parked"]));
	assert.equal(gitIn(repo, ["rev-parse", "--abbrev-ref", "HEAD"]), "topic");

	const base = gitIn(repo, ["rev-parse", "HEAD"]);
	await unwrap(
		executeCreateBranch(
			{ name: "pinned", startPoint: base, switchTo: false },
			undefined,
			repo,
		),
	);
	assert.equal(gitIn(repo, ["rev-parse", "refs/heads/pinned"]), base);
});

test("git_create_branch: duplicate and invalid names rejected before spawn", async () => {
	assert.equal(
		await errCode(() =>
			executeCreateBranch({ name: "topic" }, undefined, repo),
		),
		"INVALID_ARGUMENT",
	);
	for (const name of ["-b", "a..b", "has space", "refs/heads/x"]) {
		assert.equal(
			await errCode(() => executeCreateBranch({ name }, undefined, repo)),
			"INVALID_ARGUMENT",
			name,
		);
	}
});

test("git_add: stages named files including an untracked one", async () => {
	commitFile("src/a.ts", "export const a = 11;\n");
	commitFile("b.txt", "b\n");
	await unwrap(executeAdd({ paths: ["b.txt", "src/a.ts"] }, undefined, repo));
	const staged = gitIn(repo, ["diff", "--cached", "--name-only"]);
	assert.match(staged, /b\.txt/);
	assert.match(staged, /src\/a\.ts/);
});

test("git_add: a directory path stages its whole subtree", async () => {
	commitFile("src/deep/c.ts", "export const c = 3;\n");
	await unwrap(executeAdd({ paths: ["src"] }, undefined, repo));
	assert.match(
		gitIn(repo, ["diff", "--cached", "--name-only"]),
		/src\/deep\/c\.ts/,
	);
});

test("git_add: trackedOnly stages tracked edits, never untracked files", async () => {
	commitFile("src/a.ts", "export const a = 2;\n");
	commitFile("untracked.txt", "nope\n");
	await unwrap(executeAdd({ trackedOnly: true }, undefined, repo));
	const staged = gitIn(repo, ["diff", "--cached", "--name-only"]);
	assert.match(staged, /src\/a\.ts/);
	assert.ok(!staged.includes("untracked.txt"));
});

test("git_add: scope rejections with frozen codes", async () => {
	assert.equal(
		await errCode(() => executeAdd({ paths: [".."] }, undefined, repo)),
		"INVALID_ARGUMENT",
	);
	assert.equal(
		await errCode(() =>
			executeAdd({ paths: ["/etc/passwd"] }, undefined, repo),
		),
		"INVALID_ARGUMENT",
	);
	assert.equal(
		await errCode(() => executeAdd({ paths: [":(glob)x"] }, undefined, repo)),
		"INVALID_ARGUMENT",
	);
	assert.equal(
		await errCode(() =>
			executeAdd(
				{ paths: Array.from({ length: 101 }, (_, i) => `f${i}.txt`) },
				undefined,
				repo,
			),
		),
		"LIMIT_EXCEEDED",
	);
	assert.equal(
		await errCode(() =>
			executeAdd({ paths: ["."], trackedOnly: true }, undefined, repo),
		),
		"INVALID_ARGUMENT",
	);
});

test("git_add: literal glob matches nothing; nonexistent path is GIT_FAILED", async () => {
	assert.equal(
		await errCode(() => executeAdd({ paths: ["*.nomatch"] }, undefined, repo)),
		"GIT_FAILED",
	);
	assert.equal(
		await errCode(() =>
			executeAdd({ paths: ["does-not-exist.txt"] }, undefined, repo),
		),
		"GIT_FAILED",
	);
});

test("git_commit: exactly one commit with the exact message and file count", async () => {
	gitIn(repo, ["reset"]);
	commitFile("src/deep/c.ts", "export const c = 3;\n");
	await unwrap(
		executeAdd({ paths: ["b.txt", "src/deep/c.ts"] }, undefined, repo),
	);
	const result = (await unwrap(
		executeCommit({ message: "feat: staged pair" }, undefined, repo),
	)) as {
		details: {
			hash: string;
			shortHash: string;
			branch: string;
			filesCommitted: number;
			message: string;
		};
	};
	assert.equal(result.details.hash, gitIn(repo, ["rev-parse", "HEAD"]));
	assert.ok(
		gitIn(repo, ["rev-parse", "HEAD"]).startsWith(result.details.shortHash),
	);
	assert.equal(result.details.branch, "topic");
	assert.equal(result.details.filesCommitted, 2);
	assert.equal(gitIn(repo, ["log", "-1", "--format=%B"]), "feat: staged pair");
});

test("git_commit: empty index rejected before any spawn", async () => {
	// ensure nothing staged
	gitIn(repo, ["reset"]);
	const { recordSpawns } = await import("../helpers/companion-harness.ts");
	const rec = recordSpawns();
	try {
		const r = (await executeCommit({ message: "x" }, undefined, repo)) as {
			details: { code: string };
		};
		assert.equal(r.details.code, "INVALID_ARGUMENT");
	} finally {
		rec.restore();
	}
	assert.ok(
		!rec.spawns.some(({ args }) => args[0] === "commit"),
		`empty index must reject before the commit spawn: ${JSON.stringify(rec.spawns)}`,
	);
});

test("git_commit: failing pre-commit hook surfaces as GIT_FAILED", async () => {
	const hooks = path.join(repo, ".git", "hooks");
	writeFileSync(path.join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n");
	chmodSync(path.join(hooks, "pre-commit"), 0o755);
	try {
		commitFile("hook.txt", "hook\n");
		await unwrap(executeAdd({ paths: ["hook.txt"] }, undefined, repo));
		assert.equal(
			await errCode(() =>
				executeCommit({ message: "blocked" }, undefined, repo),
			),
			"GIT_FAILED",
		);
	} finally {
		rmSync(path.join(hooks, "pre-commit"));
	}
});

test("git_commit: never auto-stages an unstaged edit", async () => {
	commitFile("staged-now.txt", "s\n");
	await unwrap(executeAdd({ paths: ["staged-now.txt"] }, undefined, repo));
	commitFile("src/a.ts", "export const a = 99;\n");
	await unwrap(executeCommit({ message: "only staged" }, undefined, repo));
	const files = gitIn(repo, ["show", "--name-only", "--format=", "HEAD"]);
	assert.match(files, /staged-now\.txt/);
	assert.ok(!files.includes("src/a.ts"));
});

test("git_push: first push of a new branch with setUpstream sets tracking", async () => {
	const result = (await unwrap(
		executePush({ setUpstream: true }, undefined, repo),
	)) as { details: { remote: string; branch: string; pushed: boolean } };
	assert.deepEqual(result.details, {
		remote: "origin",
		branch: "topic",
		pushed: true,
	});
	assert.equal(gitIn(repo, ["config", "branch.topic.remote"]), "origin");
	assert.equal(
		remoteTip("topic"),
		gitIn(repo, ["rev-parse", "refs/heads/topic"]),
	);
});

test("git_push: second push of a new commit succeeds", async () => {
	commitFile("push2.txt", "p2\n");
	await unwrap(executeAdd({ paths: ["push2.txt"] }, undefined, repo));
	await unwrap(executeCommit({ message: "push2" }, undefined, repo));
	await unwrap(executePush({}, undefined, repo));
	assert.equal(
		remoteTip("topic"),
		gitIn(repo, ["rev-parse", "refs/heads/topic"]),
	);
});

test("git_push: missing upstream fails GIT_FAILED; unknown remote INVALID_ARGUMENT; detached HEAD GIT_FAILED", async () => {
	await unwrap(executeCreateBranch({ name: "no-upstream" }, undefined, repo));
	assert.equal(
		await errCode(() => executePush({}, undefined, repo)),
		"GIT_FAILED",
	);
	assert.equal(
		await errCode(() => executePush({ remote: "nowhere" }, undefined, repo)),
		"INVALID_ARGUMENT",
	);
	gitIn(repo, ["checkout", "--detach", "HEAD"]);
	assert.equal(
		await errCode(() => executePush({}, undefined, repo)),
		"GIT_FAILED",
	);
	gitIn(repo, ["switch", "topic"]);
});

test("git_push: non-fast-forward fails GIT_FAILED and the remote tip is unchanged", async () => {
	const beforeTip = remoteTip("topic");
	gitIn(repo, ["reset", "--hard", "HEAD~1"]);
	commitFile("divergent.txt", "divergent\n");
	await unwrap(executeAdd({ paths: ["divergent.txt"] }, undefined, repo));
	await unwrap(executeCommit({ message: "divergent" }, undefined, repo));
	assert.equal(
		await errCode(() => executePush({}, undefined, repo)),
		"GIT_FAILED",
	);
	assert.equal(remoteTip("topic"), beforeTip);
});

test("git_push: argv is always git push [--set-upstream] <remote> <branch> — every spawn is git, never a force flag", async () => {
	const { recordSpawns } = await import("../helpers/companion-harness.ts");
	const rec = recordSpawns();
	try {
		commitFile("argv-proof.txt", "argv\n");
		await unwrap(executeAdd({ paths: ["argv-proof.txt"] }, undefined, repo));
		await unwrap(executeCommit({ message: "argv proof" }, undefined, repo));
		await unwrap(executePush({}, undefined, repo));
	} finally {
		rec.restore();
	}
	for (const { program, args } of rec.spawns) {
		assert.equal(program, "git", `non-git program spawned: ${program}`);
		if (args[0] === "push") {
			assert.deepEqual(
				args.slice(0, args.length - 2).filter((a) => a !== "push"),
				[],
			);
			assert.ok(!args.some((a) => /force/.test(a)), `force in ${args}`);
		}
	}
	assert.ok(
		rec.spawns.some(({ args }) => args[0] === "push"),
		"expected at least one push spawn",
	);
});

test("git_rm_cached: untracks a tracked file, working-tree bytes unchanged", async () => {
	const r = createTempGitRepo();
	try {
		mkdirSync(path.dirname(path.join(r.dir, "notes/keep.md")), {
			recursive: true,
		});
		writeFileSync(path.join(r.dir, "notes/keep.md"), "keep-bytes\n");
		gitIn(r.dir, ["add", "notes/keep.md"]);
		gitIn(r.dir, ["commit", "-m", "track keep"]);
		const before = readFileSync(path.join(r.dir, "notes/keep.md"));
		const result = (await unwrap(
			executeRmCached({ paths: ["notes/keep.md"] }, undefined, r.dir),
		)) as { details: { removed: string[] } };
		assert.deepEqual(result.details.removed, ["notes/keep.md"]);
		assert.equal(gitIn(r.dir, ["ls-files", "notes/keep.md"]), "");
		assert.deepEqual(readFileSync(path.join(r.dir, "notes/keep.md")), before);
		assert.ok(existsSync(path.join(r.dir, "notes/keep.md")));
	} finally {
		r.cleanup();
	}
});

test("git_rm_cached: a directory path removes its index subtree, files intact on disk", async () => {
	const r = createTempGitRepo();
	try {
		mkdirSync(path.join(r.dir, "sub/deep"), { recursive: true });
		writeFileSync(path.join(r.dir, "sub/deep/x.txt"), "x\n");
		writeFileSync(path.join(r.dir, "sub/y.txt"), "y\n");
		gitIn(r.dir, ["add", "sub"]);
		gitIn(r.dir, ["commit", "-m", "track sub"]);
		const result = (await unwrap(
			executeRmCached({ paths: ["sub"] }, undefined, r.dir),
		)) as { details: { removed: string[] } };
		assert.deepEqual(result.details.removed.sort(), [
			"sub/deep/x.txt",
			"sub/y.txt",
		]);
		assert.equal(gitIn(r.dir, ["ls-files", "sub"]), "");
		assert.equal(readFileSync(path.join(r.dir, "sub/y.txt"), "utf8"), "y\n");
		assert.equal(
			readFileSync(path.join(r.dir, "sub/deep/x.txt"), "utf8"),
			"x\n",
		);
	} finally {
		r.cleanup();
	}
});

test("git_rm_cached: path absent from the index is GIT_FAILED, index unchanged", async () => {
	const r = createTempGitRepo();
	try {
		writeFileSync(path.join(r.dir, "never-committed.txt"), "n\n");
		assert.equal(
			await errCode(() =>
				executeRmCached({ paths: ["never-committed.txt"] }, undefined, r.dir),
			),
			"GIT_FAILED",
		);
		// mixed: one tracked, one untracked -> git rm fails, tracked entry stays
		assert.equal(
			await errCode(() =>
				executeRmCached(
					{ paths: ["README.md", "never-committed.txt"] },
					undefined,
					r.dir,
				),
			),
			"GIT_FAILED",
		);
		assert.ok(gitIn(r.dir, ["ls-files", "README.md"]).includes("README.md"));
	} finally {
		r.cleanup();
	}
});

test("git_rm_cached: CAPABILITY_GAP forms (-A, glob, force, extra key) reject with zero spawns", async () => {
	const { recordSpawns } = await import("../helpers/companion-harness.ts");
	const rec = recordSpawns();
	try {
		for (const p of ["-A", "--force", "*.ts", "."]) {
			assert.equal(
				await errCode(() =>
					executeRmCached({ paths: [p] }, undefined, process.cwd()),
				),
				"CAPABILITY_GAP",
				p,
			);
		}
		assert.equal(
			await errCode(() =>
				executeRmCached(
					{ force: true, paths: ["README.md"] } as never,
					undefined,
					process.cwd(),
				),
			),
			"CAPABILITY_GAP",
			"force key",
		);
	} finally {
		rec.restore();
	}
	assert.equal(
		rec.spawns.length,
		0,
		`expected zero spawns: ${JSON.stringify(rec.spawns)}`,
	);
});

test("git_rm_cached: the only rm spawn is exactly git rm -r --cached -- <paths> with literal pathspecs", async () => {
	const r = createTempGitRepo();
	const { recordSpawns } = await import("../helpers/companion-harness.ts");
	const rec = recordSpawns();
	try {
		writeFileSync(path.join(r.dir, "tracked.txt"), "t\n");
		gitIn(r.dir, ["add", "tracked.txt"]);
		gitIn(r.dir, ["commit", "-m", "t"]);
		await unwrap(executeRmCached({ paths: ["tracked.txt"] }, undefined, r.dir));
	} finally {
		rec.restore();
		r.cleanup();
	}
	const rmSpawn = rec.spawns.find(({ args }) => args[0] === "rm");
	assert.ok(rmSpawn, "expected exactly one rm spawn");
	assert.deepEqual(rmSpawn.args, ["rm", "-r", "--cached", "--", "tracked.txt"]);
	assert.equal(rmSpawn.program, "git");
	assert.equal(
		rmSpawn.env?.GIT_LITERAL_PATHSPECS,
		"1",
		"the rm spawn must run with GIT_LITERAL_PATHSPECS=1",
	);
	for (const { args } of rec.spawns) {
		assert.ok(
			!args.some(
				(a) => a === "--force" || a === "-f" || a === "--ignore-unmatch",
			),
		);
	}
});

test("git_rm_cached: scope rejections (.., absolute, option-like, pathspec magic, symlink escape) never spawn", async () => {
	const { recordSpawns } = await import("../helpers/companion-harness.ts");
	const outside = mkdtempSync(path.join(tmpdir(), "rm-cached-escape-out-"));
	const r = createTempGitRepo();
	const rec = recordSpawns();
	try {
		// symlink inside the fixture repo pointing outside the workspace
		writeFileSync(path.join(outside, "secret.txt"), "s\n");
		symlinkSync(outside, path.join(r.dir, "link"));
		const cases: Array<[string[], string]> = [
			[["../x"], "INVALID_ARGUMENT"],
			[["/etc/passwd"], "INVALID_ARGUMENT"],
			[["dir/-flag"], "INVALID_ARGUMENT"],
			[[":(glob)x"], "INVALID_ARGUMENT"],
			[["link/secret.txt"], "PATH_OUT_OF_SCOPE"],
		];
		for (const [paths, expected] of cases) {
			assert.equal(
				await errCode(() => executeRmCached({ paths }, undefined, r.dir)),
				expected,
				paths[0],
			);
		}
	} finally {
		rec.restore();
		r.cleanup();
		rmSync(outside, { recursive: true, force: true });
	}
	assert.equal(
		rec.spawns.length,
		0,
		`scope rejections must not spawn: ${JSON.stringify(rec.spawns)}`,
	);
});
