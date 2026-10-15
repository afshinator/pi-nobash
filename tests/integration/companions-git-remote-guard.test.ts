/**
 * Remote-isolation guard: no test in tests/** may target a real remote.
 * Every push fixture must use a throwaway bare repo (tmpdir-based) or be a
 * rejection literal; any http(s)://, ssh://, or git@ remote literal in a push
 * position fails. Non-vacuity is proven by planting a violating fixture in a
 * temp file and showing the scanner flags it.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO_ROOT } from "../helpers/companion-harness.ts";

/** URL / scp-like remote literals. Built from parts so this file never self-matches. */
const urlLike = (scheme: string): RegExp =>
	new RegExp(`${scheme}:${"/" + "/"}[^\\s'"\`)\\]]+`);
const scpLike = /git(@|:)[^\s'"`)\]]*(:|\/)/;

function testFiles(): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(p);
			else if (entry.name.endsWith(".ts")) out.push(p);
		}
	};
	walk(path.join(REPO_ROOT, "tests"));
	return out;
}

/**
 * A URL literal is tolerated only when it is a rejection input: the line
 * itself or the following window must assert a coded rejection.
 */
function isRejectionContext(lines: string[], i: number): boolean {
	const window = lines.slice(i, i + 14).join("\n");
	return (
		window.includes("CAPABILITY_GAP") ||
		window.includes("INVALID_ARGUMENT") ||
		window.includes("validatePushRemote") ||
		window.includes("assert.throws")
	);
}

/** Returns offending `file -> line` pairs for non-throwaway remote targets. */
export function scanForRealRemotes(
	files: Array<{ name: string; text: string }>,
): string[] {
	const bad: string[] = [];
	for (const file of files) {
		const lines = file.text.split("\n");
		for (let i = 0; i < lines.length; i += 1) {
			const line = lines[i] as string;
			if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//"))
				continue;
			const hit =
				[urlLike("https?"), urlLike("ssh")].some((re) => re.test(line)) ||
				scpLike.test(line);
			if (!hit) continue;
			if (!isRejectionContext(lines, i))
				bad.push(`${file.name}:${i + 1} -> ${line.trim()}`);
		}
	}
	return bad;
}

test("no test targets a real remote: push fixtures use throwaway bare repos only", () => {
	const files = testFiles()
		.filter((name) => !name.endsWith("companions-git-remote-guard.test.ts"))
		.map((name) => ({
			name: path.relative(REPO_ROOT, name),
			text: readFileSync(name, "utf8"),
		}));
	const bad = scanForRealRemotes(files);
	assert.deepEqual(
		bad,
		[],
		`tests must push only to throwaway bare/tmp remotes; found: ${bad.join(" | ")}`,
	);
	// The harness remote is tmpdir-based by construction.
	const harness = readFileSync(
		path.join(REPO_ROOT, "tests/helpers/companion-harness.ts"),
		"utf8",
	);
	const body = harness.slice(
		harness.indexOf("function createBareRemote"),
		harness.indexOf("function gitIn"),
	);
	assert.ok(
		body.includes("mkdtempSync") &&
			body.includes("tmpdir()") &&
			body.includes("--bare"),
		"createBareRemote must create a bare repo under tmpdir()",
	);
});

test("non-vacuity: the scanner catches a planted non-throwaway remote", () => {
	const planted = [
		"import { gitIn } from '../helpers/companion-harness.ts';",
		"gitIn(repo, ['remote', 'add', 'origin', 'https://github.com/evil/victim.git']);",
		"gitIn(repo, ['push', 'origin', 'main']);",
	].join("\n");
	const found = scanForRealRemotes([{ name: "planted.ts", text: planted }]);
	assert.equal(
		found.length,
		1,
		`plant must be flagged: ${JSON.stringify(found)}`,
	);
	assert.match(found[0] ?? "", /github\.com\/evil\/victim\.git/);
});
