import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { runQueryJsonl } from "../../../src/json/jsonl-query.ts";

const dirs: string[] = [];
function fixture(name: string, content: string): { cwd: string; path: string } {
	const dir = mkdtempSync(path.join(tmpdir(), "pi-nobash-jsonl-"));
	dirs.push(dir);
	writeFileSync(path.join(dir, name), content);
	return { cwd: dir, path: name };
}

function out(result: {
	content: unknown;
	details: unknown;
	isError?: boolean;
}) {
	const content = result.content as Array<{ text?: string }>;
	return {
		isError: result.isError === true,
		text: content[0]?.text ?? "",
		details: result.details as {
			code?: string;
			scannedLines?: number;
			parsedLines?: number;
			skippedMalformedLines?: number;
			matchedLines?: number;
			returnedRows?: number;
			truncated?: boolean;
			results?: unknown[];
		},
	};
}

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("query_jsonl: filter/project/limit with scan metrics", async () => {
	const { cwd, path: file } = fixture(
		"d.jsonl",
		[
			JSON.stringify({ n: 1, kind: "a" }),
			JSON.stringify({ n: 2, kind: "b" }),
			JSON.stringify({ n: 3, kind: "b" }),
			JSON.stringify({ n: 4, kind: "a" }),
		].join("\n"),
	);
	const r = out(
		await runQueryJsonl(
			{
				path: file,
				malformedLine: "error",
				where: [{ path: [{ key: "n" }], op: "gte", value: 2 }],
				select: [{ as: "n", path: [{ key: "n" }] }],
				limit: 2,
			},
			cwd,
		),
	);
	assert.equal(r.isError, false);
	assert.deepEqual(r.details.results, [{ n: 2 }, { n: 3 }]);
	assert.equal(r.details.scannedLines, 4);
	assert.equal(r.details.parsedLines, 4);
	assert.equal(r.details.matchedLines, 3);
	assert.equal(r.details.returnedRows, 2);
	assert.equal(r.details.truncated, true);
});

test("query_jsonl: malformedLine skip vs error", async () => {
	const { cwd, path: file } = fixture(
		"m.jsonl",
		'{"n":1}\nnot-json\n{"n":2}\n',
	);
	const skip = out(
		await runQueryJsonl({ path: file, malformedLine: "skip", limit: 10 }, cwd),
	);
	assert.equal(skip.isError, false);
	assert.equal(skip.details.skippedMalformedLines, 1);
	assert.equal(skip.details.parsedLines, 2);
	assert.equal(skip.details.matchedLines, 2);

	const err = out(
		await runQueryJsonl({ path: file, malformedLine: "error" }, cwd),
	);
	assert.equal(err.isError, true);
	assert.equal(err.details.code, "PARSE_ERROR");
});

test("query_jsonl: groupBy with aggregate computes per-group results", async () => {
	const { cwd, path: file } = fixture(
		"g.jsonl",
		[
			JSON.stringify({ kind: "a", n: 1 }),
			JSON.stringify({ kind: "a", n: 3 }),
			JSON.stringify({ kind: "b", n: 10 }),
		].join("\n"),
	);
	const r = out(
		await runQueryJsonl(
			{
				path: file,
				malformedLine: "error",
				groupBy: [{ as: "kind", path: [{ key: "kind" }] }],
				aggregate: [{ as: "sum", fn: "sum", path: [{ key: "n" }] }],
			},
			cwd,
		),
	);
	assert.equal(r.isError, false);
	assert.deepEqual(r.details.results, [
		{ kind: "a", sum: 4 },
		{ kind: "b", sum: 10 },
	]);
});

test("query_jsonl: line-size limit is LIMIT_EXCEEDED", async () => {
	const { cwd, path: file } = fixture(
		"big.jsonl",
		"x".repeat(2 * 1024 * 1024 + 10),
	);
	const r = out(
		await runQueryJsonl({ path: file, malformedLine: "error" }, cwd),
	);
	assert.equal(r.isError, true);
	assert.equal(r.details.code, "LIMIT_EXCEEDED");
});

test("query_jsonl: safe-number policy applies per line", async () => {
	const { cwd, path: file } = fixture("num.jsonl", '{"n": 9007199254740993}\n');
	const r = out(
		await runQueryJsonl({ path: file, malformedLine: "error" }, cwd),
	);
	assert.equal(r.isError, true);
	assert.equal(r.details.code, "LIMIT_EXCEEDED");
});

test("query_jsonl: more distinct groups than the cap is LIMIT_EXCEEDED", async () => {
	const lines = Array.from(
		{ length: 10_001 },
		(_, i) => `{"g":${i},"status":"x"}`,
	);
	const { cwd, path: file } = fixture(
		"many-groups.jsonl",
		`${lines.join("\n")}\n`,
	);
	const r = out(
		await runQueryJsonl(
			{
				path: file,
				malformedLine: "error",
				groupBy: [{ as: "g", path: [{ key: "g" }] }],
			},
			cwd,
		),
	);
	assert.equal(r.isError, true);
	assert.equal(r.details.code, "LIMIT_EXCEEDED");
});

test("query_jsonl: order buffer beyond the cap is LIMIT_EXCEEDED", async () => {
	const lines = Array.from(
		{ length: 501 },
		(_, i) => `{"v":${i},"status":"x"}`,
	);
	const { cwd, path: file } = fixture(
		"many-rows.jsonl",
		`${lines.join("\n")}\n`,
	);
	const r = out(
		await runQueryJsonl(
			{
				path: file,
				malformedLine: "error",
				select: [{ as: "v", path: [{ key: "v" }] }],
				orderBy: [{ field: "v", direction: "asc" }],
			},
			cwd,
		),
	);
	assert.equal(r.isError, true);
	assert.equal(r.details.code, "LIMIT_EXCEEDED");
});

test("query_jsonl: normal grouped query still passes below the caps", async () => {
	const lines = Array.from(
		{ length: 100 },
		(_, i) => `{"g":"g${i % 7}","status":"x"}`,
	);
	const { cwd, path: file } = fixture(
		"small-groups.jsonl",
		`${lines.join("\n")}\n`,
	);
	const r = out(
		await runQueryJsonl(
			{
				path: file,
				malformedLine: "error",
				groupBy: [{ as: "g", path: [{ key: "g" }] }],
				aggregate: [{ as: "count", fn: "count" }],
				orderBy: [{ field: "count", direction: "desc" }],
				limit: 10,
			},
			cwd,
		),
	);
	assert.equal(r.isError, false);
	assert.equal(r.details.returnedRows, 7);
});
