/**
 * G4 docs/stacks guard: every relative link in docs/stacks/*.md resolves to a
 * file in the tree, and every tool table in the four stack docs carries a
 * Status column whose cells say implemented/proposed.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const STACKS_DIR = path.resolve(import.meta.dirname, "../../docs/stacks");

const stackDocs = readdirSync(STACKS_DIR).filter(
	(f) => f.endsWith(".md") && existsSync(path.join(STACKS_DIR, f)),
);

test("every relative link in docs/stacks/*.md resolves to an existing file", () => {
	const broken: string[] = [];
	for (const doc of stackDocs) {
		const text = readFileSync(path.join(STACKS_DIR, doc), "utf8");
		for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
			const target = (match[1] as string).trim();
			// anchors, absolute URLs, and mailto links are out of scope
			if (/^(https?:|mailto:|#)/.test(target)) continue;
			const file = target.split("#")[0] as string;
			if (file.length === 0) continue; // pure anchor link
			if (!existsSync(path.resolve(STACKS_DIR, file)))
				broken.push(`${doc} -> ${target}`);
		}
	}
	assert.deepEqual(
		broken,
		[],
		`broken relative links in docs/stacks: ${broken.join(", ")}`,
	);
});

/** Status vocabulary the plan's DoD requires in every tool table. */
const STATUSES = new Set(["implemented", "proposed"]);

/** Splits a markdown table row on unescaped pipes only (`\|` is content). */
function splitCells(row: string): string[] {
	return row.split(/(?<!\\)\|/);
}

test("every tool table in the stack docs carries a Status column (implemented/proposed)", () => {
	const problems: string[] = [];
	for (const doc of ["README.md", "typescript.md", "python.md", "rust-go.md"]) {
		const lines = readFileSync(path.join(STACKS_DIR, doc), "utf8").split("\n");
		let table: string[] | null = null;
		const flush = () => {
			if (!table) return;
			const header = (table[0] ?? "").toLowerCase();
			const statusIdx = splitCells(header).findIndex(
				(cell) => cell.trim().toLowerCase() === "status",
			);
			if (statusIdx === -1) {
				problems.push(`${doc}: tool table has no Status column: ${table[0]}`);
			} else {
				for (const row of table.slice(1)) {
					// markdown delimiter row (|---|:---:) — not a data row
					if (splitCells(row).every((c) => /^[-:\s]*$/.test(c))) continue;
					const cell = splitCells(row)[statusIdx]?.trim().toLowerCase();
					if (!STATUSES.has(cell ?? ""))
						problems.push(
							`${doc}: Status cell must be implemented|proposed: ${row}`,
						);
				}
			}
			table = null;
		};
		for (const line of lines) {
			if (line.trimStart().startsWith("|")) {
				if (table === null) {
					// only tables whose header names a Tool column are tool tables
					if (
						line
							.toLowerCase()
							.split("|")
							.some((c) => c.trim() === "tool")
					)
						table = [line];
				} else {
					table.push(line);
				}
			} else {
				flush();
			}
		}
		flush();
	}
	assert.deepEqual(
		problems,
		[],
		`docs/stacks tool tables must carry a Status column (implemented|proposed): ${problems.join("; ")}`,
	);
});
