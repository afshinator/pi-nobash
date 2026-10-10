import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { registerJsonTools } from "../../../src/json/index.ts";
import { runJsonQuery } from "../../../src/json/json-query.ts";

const dirs: string[] = [];
function fixture(name: string, content: string): { cwd: string; path: string } {
	const dir = mkdtempSync(path.join(tmpdir(), "pi-nobash-json-"));
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
			message?: string;
			capability?: string;
			matched?: number;
			returned?: number;
			truncated?: boolean;
			results?: unknown[];
		},
	};
}

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("json_query: filter, project, order, limit over a root array", async () => {
	const { cwd, path: file } = fixture(
		"d.json",
		JSON.stringify([
			{ name: "c", v: 3 },
			{ name: "a", v: 1 },
			{ name: "b", v: 2 },
		]),
	);
	const r = out(
		await runJsonQuery(
			{
				path: file,
				select: [{ as: "name", path: [{ key: "name" }] }],
				orderBy: [{ field: "name", direction: "asc" }],
				limit: 2,
			},
			cwd,
		),
	);
	assert.equal(r.isError, false);
	assert.deepEqual(r.details.results, [{ name: "a" }, { name: "b" }]);
	assert.equal(r.details.matched, 3);
	assert.equal(r.details.returned, 2);
	assert.equal(r.details.truncated, true);
});

test("json_query: missing vs null preserved in projection", async () => {
	const { cwd, path: file } = fixture(
		"m.json",
		JSON.stringify([{ a: null }, { b: 1 }]),
	);
	const r = out(
		await runJsonQuery(
			{
				path: file,
				select: [
					{ as: "a", path: [{ key: "a" }] },
					{ as: "b", path: [{ key: "b" }] },
				],
			},
			cwd,
		),
	);
	assert.equal(r.isError, false);
	assert.deepEqual(r.details.results, [{ a: null }, { b: 1 }]);
});

test("json_query: aggregates over filtered records", async () => {
	const { cwd, path: file } = fixture(
		"a.json",
		JSON.stringify({ items: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] }),
	);
	const r = out(
		await runJsonQuery(
			{
				path: file,
				root: [{ key: "items" }],
				where: [{ path: [{ key: "n" }], op: "gte", value: 2 }],
				aggregate: [{ as: "sum", fn: "sum", path: [{ key: "n" }] }],
			},
			cwd,
		),
	);
	assert.equal(r.isError, false);
	assert.deepEqual(r.details.results, [{ sum: 9 }]);
	assert.equal(r.details.matched, 3);
});

test("json_query: malformed JSON is PARSE_ERROR", async () => {
	const { cwd, path: file } = fixture("bad.json", "{not json");
	const r = out(await runJsonQuery({ path: file }, cwd));
	assert.equal(r.isError, true);
	assert.equal(r.details.code, "PARSE_ERROR");
	assert.ok(r.text.startsWith("PARSE_ERROR: "));
});

test("json_query: numeric aggregates never coerce strings", async () => {
	const { cwd, path: file } = fixture("s.json", JSON.stringify([{ n: "2" }]));
	const r = out(
		await runJsonQuery(
			{
				path: file,
				aggregate: [{ as: "sum", fn: "sum", path: [{ key: "n" }] }],
			},
			cwd,
		),
	);
	assert.equal(r.isError, true);
	assert.equal(r.details.code, "INVALID_ARGUMENT");
});

test("json_query: orderBy on an unprojected path is CAPABILITY_GAP; select+aggregate rejected", async () => {
	const { cwd, path: file } = fixture("d.json", JSON.stringify([{ n: 1 }]));
	const a = out(
		await runJsonQuery(
			{ path: file, orderBy: [{ field: "n", direction: "asc" }] },
			cwd,
		),
	);
	assert.equal(a.isError, true);
	assert.equal(a.details.code, "CAPABILITY_GAP");
	assert.equal(a.details.capability, "order_by_raw_path");
	assert.ok(a.text.startsWith("CAPABILITY_GAP: "));

	const b = out(
		await runJsonQuery(
			{
				path: file,
				select: [{ as: "n", path: [{ key: "n" }] }],
				aggregate: [{ as: "sum", fn: "sum", path: [{ key: "n" }] }],
			},
			cwd,
		),
	);
	assert.equal(b.isError, true);
	assert.equal(b.details.code, "INVALID_ARGUMENT");
});

test("json_query: registered tool returns a CAPABILITY_GAP envelope end-to-end", async () => {
	const { cwd, path: file } = fixture("e.json", JSON.stringify([{ n: 1 }]));
	const registered: Array<{
		name: string;
		execute: (
			id: string,
			params: unknown,
			signal: undefined,
			onUpdate: undefined,
			ctx: { cwd: string },
		) => Promise<{ content: unknown; details: unknown; isError?: boolean }>;
	}> = [];
	const mockPi = {
		registerTool: (tool: (typeof registered)[number]) => registered.push(tool),
	} as unknown as Parameters<typeof registerJsonTools>[0];
	registerJsonTools(mockPi);
	const tool = registered.find((t) => t.name === "json_query");
	assert.ok(tool, "json_query must be registered");
	const result = out(
		await tool.execute(
			"t1",
			{ path: file, orderBy: [{ field: "n", direction: "asc" }] },
			undefined,
			undefined,
			{ cwd },
		),
	);
	assert.equal(result.isError, true);
	assert.equal(result.details.code, "CAPABILITY_GAP");
	assert.equal(result.details.capability, "order_by_raw_path");
	assert.ok(result.text.startsWith("CAPABILITY_GAP: "));
});

test("json_query: unsafe integer token is LIMIT_EXCEEDED", async () => {
	const { cwd, path: file } = fixture("big.json", '{"n": 9007199254740993}');
	const r = out(await runJsonQuery({ path: file }, cwd));
	assert.equal(r.isError, true);
	assert.equal(r.details.code, "LIMIT_EXCEEDED");
});
