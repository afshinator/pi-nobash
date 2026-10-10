import assert from "node:assert/strict";
import { test } from "node:test";
import { type JsonValue, ToolError } from "../../../src/errors.ts";
import {
	aggregateRecords,
	assertSafeNumbers,
	compareScalars,
	evaluatePredicate,
	getPath,
	validateQueryShape,
} from "../../../src/json/operators.ts";
import type {
	Aggregate,
	Predicate,
	Selection,
} from "../../../src/json/types.ts";

test("getPath: resolves key/index and distinguishes missing from null", () => {
	const doc = { a: { b: null }, arr: [1, 2, 3] };
	assert.deepEqual(getPath(doc, [{ key: "a" }, { key: "b" }]), {
		found: true,
		value: null,
	});
	assert.deepEqual(getPath(doc, [{ key: "missing" }]), { found: false });
	assert.deepEqual(getPath(doc, [{ key: "arr" }, { index: 1 }]), {
		found: true,
		value: 2,
	});
	assert.deepEqual(getPath(doc, [{ key: "arr" }, { index: 9 }]), {
		found: false,
	});
});

test("evaluatePredicate: eq/ne/lt/lte/gt/gte numeric and string semantics", () => {
	const p = (op: Predicate["op"], value: JsonValue): Predicate => ({
		path: [{ key: "n" }],
		op,
		value,
	});
	const rec = { n: 5, s: "b" };
	assert.equal(evaluatePredicate(rec, p("eq", 5)), true);
	assert.equal(
		evaluatePredicate(rec, p("eq", "5")),
		false,
		"no string coercion",
	);
	assert.equal(evaluatePredicate(rec, p("ne", 5)), false);
	assert.equal(evaluatePredicate(rec, p("lt", 6)), true);
	assert.equal(evaluatePredicate(rec, p("gte", 5)), true);
	assert.equal(
		evaluatePredicate(
			{ s: "b" },
			{ path: [{ key: "s" }], op: "lt", value: "c" },
		),
		true,
	);
	assert.equal(
		evaluatePredicate(rec, p("lt", "a")),
		false,
		"mixed types not comparable",
	);
});

test("evaluatePredicate: exists, is_null, in, contains_string", () => {
	assert.equal(
		evaluatePredicate({ x: null }, { path: [{ key: "x" }], op: "exists" }),
		true,
	);
	assert.equal(
		evaluatePredicate({ x: null }, { path: [{ key: "x" }], op: "is_null" }),
		true,
	);
	assert.equal(
		evaluatePredicate({}, { path: [{ key: "x" }], op: "is_null" }),
		false,
	);
	assert.equal(
		evaluatePredicate(
			{ n: 2 },
			{ path: [{ key: "n" }], op: "in", value: [1, 2, 3] },
		),
		true,
	);
	assert.equal(
		evaluatePredicate(
			{ s: "hello" },
			{ path: [{ key: "s" }], op: "contains_string", value: "ell" },
		),
		true,
	);
});

test("assertSafeNumbers: rejects unsafe integers and non-finite numbers", () => {
	assert.doesNotThrow(() =>
		assertSafeNumbers({ a: 1.5, b: Number.MAX_SAFE_INTEGER }),
	);
	assert.throws(
		() => assertSafeNumbers({ a: 9007199254740992 }),
		(e: unknown) => e instanceof ToolError && e.code === "LIMIT_EXCEEDED",
	);
	assert.throws(
		() => assertSafeNumbers({ a: Number.POSITIVE_INFINITY }),
		(e: unknown) => e instanceof ToolError && e.code === "LIMIT_EXCEEDED",
	);
});

test("validateQueryShape: duplicate alias, orderBy must name an alias, aggregate path rule", () => {
	const sel: Selection[] = [{ as: "x", path: [{ key: "x" }] }];
	assert.doesNotThrow(() => validateQueryShape(sel, undefined, undefined));
	assert.throws(
		() =>
			validateQueryShape(
				[
					{ as: "x", path: [{ key: "x" }] },
					{ as: "x", path: [{ key: "y" }] },
				],
				undefined,
				undefined,
			),
		ToolError,
	);
	assert.throws(
		() =>
			validateQueryShape(sel, undefined, [
				{ field: "missing", direction: "asc" },
			]),
		(e: unknown) =>
			e instanceof ToolError &&
			e.code === "CAPABILITY_GAP" &&
			e.capability === "order_by_raw_path",
	);
	assert.throws(
		() => validateQueryShape(undefined, [{ as: "sum", fn: "sum" }], undefined),
		(e: unknown) => e instanceof ToolError && e.code === "INVALID_ARGUMENT",
	);
});

test("compareScalars: deterministic total order for null/boolean/number/string", () => {
	assert.equal(compareScalars(null, null), 0);
	assert.equal(compareScalars(undefined, null), 0);
	assert.ok(compareScalars(false, true) < 0);
	assert.ok(compareScalars(1, "a") < 0);
	assert.ok(compareScalars("a", "b") < 0);
	assert.ok(compareScalars(2, 1) > 0);
});

test("aggregateRecords: count/sum/min/max/avg with numeric-only policy", () => {
	const records = [{ n: 1 }, { n: 2 }, { n: 3 }, { other: 9 }];
	const aggs: Aggregate[] = [
		{ as: "count", fn: "count" },
		{ as: "countn", fn: "count", path: [{ key: "n" }] },
		{ as: "sum", fn: "sum", path: [{ key: "n" }] },
		{ as: "min", fn: "min", path: [{ key: "n" }] },
		{ as: "max", fn: "max", path: [{ key: "n" }] },
		{ as: "avg", fn: "avg", path: [{ key: "n" }] },
	];
	assert.deepEqual(aggregateRecords(records, aggs), {
		count: 4,
		countn: 3,
		sum: 6,
		min: 1,
		max: 3,
		avg: 2,
	});

	assert.throws(
		() =>
			aggregateRecords(
				[{ n: "2" }],
				[{ as: "sum", fn: "sum", path: [{ key: "n" }] }],
			),
		(e: unknown) => e instanceof ToolError && e.code === "INVALID_ARGUMENT",
	);
	assert.throws(
		() =>
			aggregateRecords([], [{ as: "avg", fn: "avg", path: [{ key: "n" }] }]),
		(e: unknown) => e instanceof ToolError && e.code === "INVALID_ARGUMENT",
	);
});
