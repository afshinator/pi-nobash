/**
 * Markdown that ships inside the npm tarball — the root README and any shipped
 * docs such as `companions/README.md` — must not link relatively to a path
 * outside the `files` allowlist. A relative link to an unshipped path (for
 * example `docs/…`) renders on GitHub and 404s on the npm package page, so use
 * an absolute URL for anything not shipped.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
	files: string[];
};

const isShipped = (target: string): boolean =>
	pkg.files.some((entry) => target === entry || target.startsWith(`${entry}/`));

/** Markdown that ships: the root README plus every `.md` under a shipped directory. */
function shippedMarkdown(): string[] {
	const out = ["README.md"];
	for (const entry of pkg.files) {
		if (entry === "README.md") continue;
		try {
			for (const dirent of readdirSync(entry, {
				recursive: true,
				withFileTypes: true,
			})) {
				if (dirent.isFile() && dirent.name.endsWith(".md"))
					out.push(`${dirent.parentPath}/${dirent.name}`);
			}
		} catch {
			// not a directory, or not present — nothing to check under it
		}
	}
	return out;
}

test("shipped markdown must not link relatively to unshipped paths", () => {
	const bad: string[] = [];
	for (const file of shippedMarkdown()) {
		const text = readFileSync(file, "utf8");
		for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
			const target = (match[1] as string).trim();
			if (/^(https?:|mailto:|#)/.test(target)) continue; // absolute or anchor
			if (!isShipped(target.split("#")[0] as string))
				bad.push(`${file} -> ${target}`);
		}
	}
	assert.deepEqual(
		bad,
		[],
		`shipped markdown relative links must point at shipped paths or use absolute URLs: ${bad.join(", ")}`,
	);
});
