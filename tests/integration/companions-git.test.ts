import assert from "node:assert/strict";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { executeAdd } from "../../companions/git/add.ts";
import { executeCommit } from "../../companions/git/commit.ts";
import { executeCreateBranch } from "../../companions/git/create-branch.ts";
import { executePush } from "../../companions/git/push.ts";
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
