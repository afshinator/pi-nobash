/**
 * The README ships inside the npm tarball. A relative link to a path that is not
 * in the `files` allowlist (for example `docs/…`) renders on GitHub and 404s on
 * the npm package page, so require every relative README link to point at a
 * shipped path — otherwise use an absolute URL.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const README = readFileSync("README.md", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
	files: string[];
};

const isShipped = (target: string): boolean =>
	pkg.files.some((entry) => target === entry || target.startsWith(`${entry}/`));

test("README relative links must point at files shipped by the files allowlist", () => {
	const bad = [...README.matchAll(/\]\(([^)]+)\)/g)]
		.map((m) => (m[1] as string).trim())
		.filter((target) => {
			if (/^(https?:|mailto:|#)/.test(target)) return false; // absolute or anchor
			return !isShipped(target.split("#")[0] as string);
		});
	assert.deepEqual(
		bad,
		[],
		`relative README links must be shipped (add the path to package.json "files") or absolute: ${bad.join(", ")}`,
	);
});
