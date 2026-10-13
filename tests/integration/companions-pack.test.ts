import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { promisify } from "node:util";
import { REPO_ROOT } from "../helpers/companion-harness.ts";

function packFiles(stdout: string): { path: string }[] {
	const parsed: unknown = JSON.parse(stdout);
	const first = (parsed as { files?: { path: string }[] }[])[0];
	assert.ok(first?.files, "npm pack --json returned no pack entry");
	return first.files;
}

const run = promisify(execFile);

test("npm tarball ships the companions source tree (FD2)", async () => {
	const { stdout } = await run("npm", ["pack", "--dry-run", "--json"], {
		cwd: REPO_ROOT,
	});
	const paths = new Set(packFiles(stdout).map((f) => f.path));
	for (const required of [
		"companions/process.ts",
		"companions/git/index.ts",
		"companions/git/create-branch.ts",
		"companions/git/add.ts",
		"companions/git/commit.ts",
		"companions/git/push.ts",
	]) {
		assert.ok(
			paths.has(required),
			`${required} missing from the packed tarball`,
		);
	}
});

test("package.json pi.extensions is the single core entry (A14), companions are files-allowed (FD2)", () => {
	const pkg = JSON.parse(
		readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
	) as {
		files?: string[];
		pi?: { extensions?: string[] };
	};
	assert.deepEqual(pkg.pi?.extensions, ["./extensions/pi-nobash.ts"]);
	assert.ok(pkg.files?.includes("companions"), "files must allow companions");
});
