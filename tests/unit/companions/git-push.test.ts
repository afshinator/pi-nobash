import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildPushArgv,
	executePush,
	validatePushRemote,
} from "../../../companions/git/push.ts";
import { recordSpawns } from "../../helpers/companion-harness.ts";

test("buildPushArgv: exactly git push <remote> <branch>", () => {
	assert.deepEqual(buildPushArgv("origin", "main", false), [
		"push",
		"origin",
		"main",
	]);
});

test("buildPushArgv: setUpstream adds --set-upstream — the only flag", () => {
	assert.deepEqual(buildPushArgv("origin", "topic", true), [
		"push",
		"--set-upstream",
		"origin",
		"topic",
	]);
});

test("buildPushArgv: no force, refspec, tags, or URL can ever appear", () => {
	for (const setUpstream of [false, true]) {
		const argv = buildPushArgv("origin", "topic", setUpstream);
		for (const flag of ["--force", "-f", "--force-with-lease", "--tags"]) {
			assert.ok(!argv.includes(flag), `${flag} leaked into ${argv}`);
		}
		assert.ok(!argv.some((a) => a.includes(":")), `refspec in ${argv}`);
	}
});

test("validatePushRemote rejects empty or option-like remote names", () => {
	assert.equal(validatePushRemote("upstream"), "upstream");
	assert.throws(() => validatePushRemote(""));
	assert.throws(() => validatePushRemote("--set-upstream"));
	assert.throws(() => validatePushRemote("a b"));
	assert.throws(() => validatePushRemote("https://x.git"));
});

test("unsupported push operations return CAPABILITY_GAP with zero git spawns", async () => {
	const rec = recordSpawns();
	try {
		for (const raw of [
			{ force: true },
			{ forceWithLease: true },
			{ refspec: "main:main" },
			{ ref: "main" },
			{ tags: true },
			{ delete: true },
			{ mirror: true },
			{ prune: true },
			{ url: "https://example.com/repo.git" },
		]) {
			const r = (await executePush(
				raw as { remote?: string; setUpstream?: boolean },
				undefined,
				process.cwd(),
			)) as { details: { code: string; capability?: string } };
			assert.equal(
				r.details.code,
				"CAPABILITY_GAP",
				`expected CAPABILITY_GAP for ${JSON.stringify(raw)}`,
			);
			assert.match(r.details.capability ?? "", /git_push/);
		}
	} finally {
		rec.restore();
	}
	assert.equal(rec.spawns.length, 0, `spawned: ${JSON.stringify(rec.spawns)}`);
});

test("a remote URL (remote creation/push-to-URL) is CAPABILITY_GAP, not a spawn", async () => {
	const rec = recordSpawns();
	try {
		const r = (await executePush(
			{ remote: "https://example.com/repo.git" },
			undefined,
			process.cwd(),
		)) as { details: { code: string } };
		assert.equal(r.details.code, "CAPABILITY_GAP");
	} finally {
		rec.restore();
	}
	assert.equal(rec.spawns.length, 0);
});

test("existing no-force argv proof still holds", () => {
	for (const setUpstream of [false, true]) {
		const argv = buildPushArgv("origin", "topic", setUpstream);
		assert.ok(!argv.some((a) => /force/.test(a)), `force in ${argv}`);
	}
});
