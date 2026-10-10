import { type JsonValue, ToolError } from "../errors.ts";
import type {
	Aggregate,
	JsonPath,
	JsonScalar,
	OrderBy,
	Predicate,
	Selection,
} from "./types.ts";

export type PathLookup = { found: true; value: JsonValue } | { found: false };

export function getPath(node: JsonValue, path: JsonPath): PathLookup {
	let cur: JsonValue | undefined = node;
	for (const seg of path) {
		if (cur === undefined) return { found: false };
		if ("key" in seg) {
			if (typeof cur === "object" && cur !== null && !Array.isArray(cur)) {
				const obj = cur as Record<string, JsonValue>;
				if (!(seg.key in obj)) return { found: false };
				cur = obj[seg.key];
			} else {
				return { found: false };
			}
		} else if (Array.isArray(cur) && seg.index >= 0 && seg.index < cur.length) {
			cur = cur[seg.index];
		} else {
			return { found: false };
		}
	}
	return { found: true, value: cur as JsonValue };
}

function isScalar(v: unknown): v is JsonScalar {
	return (
		typeof v === "string" ||
		typeof v === "number" ||
		typeof v === "boolean" ||
		v === null
	);
}

/** Deterministic total order for projected scalar fields (missing/null sort together). */
export function compareScalars(
	a: JsonValue | undefined,
	b: JsonValue | undefined,
): number {
	const rank = (v: JsonValue | undefined): number => {
		if (v === undefined || v === null) return 0;
		if (typeof v === "boolean") return 1;
		if (typeof v === "number") return 2;
		if (typeof v === "string") return 3;
		return 4;
	};
	const ra = rank(a);
	const rb = rank(b);
	if (ra !== rb) return ra - rb;
	switch (ra) {
		case 0:
			return 0;
		case 1:
			return (a === true ? 1 : 0) - (b === true ? 1 : 0);
		case 2: {
			const na = a as number;
			const nb = b as number;
			return na < nb ? -1 : na > nb ? 1 : 0;
		}
		case 3: {
			const sa = a as string;
			const sb = b as string;
			return sa < sb ? -1 : sa > sb ? 1 : 0;
		}
		default:
			return 0;
	}
}

export function evaluatePredicate(record: JsonValue, pred: Predicate): boolean {
	const lookup = getPath(record, pred.path);
	switch (pred.op) {
		case "exists":
			return lookup.found;
		case "is_null":
			return lookup.found && lookup.value === null;
		case "eq":
			return lookup.found && lookup.value === pred.value;
		case "ne":
			return !(lookup.found && lookup.value === pred.value);
		case "lt":
		case "lte":
		case "gt":
		case "gte": {
			if (!lookup.found) return false;
			const a = lookup.value;
			const b = pred.value;
			if (typeof a === "number" && typeof b === "number") {
				if (pred.op === "lt") return a < b;
				if (pred.op === "lte") return a <= b;
				if (pred.op === "gt") return a > b;
				return a >= b;
			}
			if (typeof a === "string" && typeof b === "string") {
				if (pred.op === "lt") return a < b;
				if (pred.op === "lte") return a <= b;
				if (pred.op === "gt") return a > b;
				return a >= b;
			}
			return false;
		}
		case "in": {
			if (!lookup.found || !isScalar(lookup.value)) return false;
			return Array.isArray(pred.value) && pred.value.includes(lookup.value);
		}
		case "contains_string": {
			if (!lookup.found || typeof lookup.value !== "string") return false;
			return lookup.value.includes(pred.value as string);
		}
	}
}

/** Shared numeric policy §9.5: reject non-finite and unsafe-integer JSON numbers. */
export function assertSafeNumbers(value: JsonValue): void {
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new ToolError(
				"LIMIT_EXCEEDED",
				"non-finite number is not supported",
			);
		}
		if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
			throw new ToolError(
				"LIMIT_EXCEEDED",
				"integer outside the safe range is not supported",
			);
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const v of value) assertSafeNumbers(v);
		return;
	}
	if (typeof value === "object" && value !== null) {
		for (const v of Object.values(value)) assertSafeNumbers(v as JsonValue);
	}
}

export function validatePredicates(predicates: Predicate[]): void {
	for (const p of predicates) {
		switch (p.op) {
			case "exists":
			case "is_null":
				if (p.value !== undefined) {
					throw new ToolError(
						"INVALID_ARGUMENT",
						`predicate "${p.op}" must not carry a value`,
					);
				}
				break;
			case "in":
				if (!Array.isArray(p.value) || !p.value.every(isScalar)) {
					throw new ToolError(
						"INVALID_ARGUMENT",
						'predicate "in" requires an array of scalar values',
					);
				}
				break;
			case "contains_string":
				if (typeof p.value !== "string") {
					throw new ToolError(
						"INVALID_ARGUMENT",
						'predicate "contains_string" requires a string value',
					);
				}
				break;
			default:
				if (!isScalar(p.value)) {
					throw new ToolError(
						"INVALID_ARGUMENT",
						`predicate "${p.op}" requires a scalar value`,
					);
				}
		}
	}
}

export function matchesAll(
	record: JsonValue,
	predicates: Predicate[],
): boolean {
	for (const p of predicates) {
		if (!evaluatePredicate(record, p)) return false;
	}
	return true;
}

export function projectRecord(
	record: JsonValue,
	selections: Selection[],
): Record<string, JsonValue> {
	const out: Record<string, JsonValue> = {};
	for (const s of selections) {
		const lookup = getPath(record, s.path);
		if (lookup.found) out[s.as] = lookup.value;
	}
	return out;
}

export function validateQueryShape(
	select: Selection[] | undefined,
	aggregate: Aggregate[] | undefined,
	orderBy: OrderBy[] | undefined,
): Set<string> {
	const aliases = new Set<string>();
	for (const s of select ?? []) {
		if (aliases.has(s.as))
			throw new ToolError("INVALID_ARGUMENT", `duplicate alias: ${s.as}`);
		aliases.add(s.as);
	}
	for (const a of aggregate ?? []) {
		if (aliases.has(a.as))
			throw new ToolError("INVALID_ARGUMENT", `duplicate alias: ${a.as}`);
		aliases.add(a.as);
		if (a.fn !== "count" && a.path === undefined) {
			throw new ToolError(
				"INVALID_ARGUMENT",
				`aggregate "${a.fn}" requires a path`,
			);
		}
	}
	for (const ob of orderBy ?? []) {
		if (!aliases.has(ob.field)) {
			throw new ToolError(
				"CAPABILITY_GAP",
				`this package does not support ordering by an unprojected path: ${ob.field}`,
				"order_by_raw_path",
			);
		}
	}
	return aliases;
}

type CountAcc = {
	as: string;
	fn: "count";
	path: JsonPath | undefined;
	count: number;
};
type NumericAcc = {
	as: string;
	fn: "sum" | "min" | "max" | "avg";
	path: JsonPath;
	count: number;
	sum: number;
	min: number;
	max: number;
};
export type AggregateAcc = CountAcc | NumericAcc;

export function newAggregateAccs(aggregates: Aggregate[]): AggregateAcc[] {
	return aggregates.map((a) => {
		if (a.fn === "count")
			return { as: a.as, fn: "count", path: a.path, count: 0 };
		return {
			as: a.as,
			fn: a.fn,
			path: a.path as JsonPath,
			count: 0,
			sum: 0,
			min: Number.NaN,
			max: Number.NaN,
		};
	});
}

export function foldAggregateAccs(
	accs: AggregateAcc[],
	record: JsonValue,
): void {
	for (const acc of accs) {
		if (acc.fn === "count") {
			if (acc.path === undefined) acc.count += 1;
			else if (getPath(record, acc.path).found) acc.count += 1;
			continue;
		}
		const lookup = getPath(record, acc.path);
		if (!lookup.found) continue;
		const v = lookup.value;
		if (typeof v !== "number") {
			throw new ToolError(
				"INVALID_ARGUMENT",
				`aggregate "${acc.fn}" requires JSON numbers`,
			);
		}
		acc.count += 1;
		acc.sum += v;
		if (!Number.isFinite(acc.sum)) {
			throw new ToolError(
				"LIMIT_EXCEEDED",
				`aggregate "${acc.fn}" produced a non-finite result`,
			);
		}
		if (Number.isNaN(acc.min)) {
			acc.min = v;
			acc.max = v;
		} else {
			acc.min = Math.min(acc.min, v);
			acc.max = Math.max(acc.max, v);
		}
	}
}

export function finalizeAggregateAccs(
	accs: AggregateAcc[],
): Record<string, JsonValue> {
	const out: Record<string, JsonValue> = {};
	for (const acc of accs) {
		switch (acc.fn) {
			case "count":
				out[acc.as] = acc.count;
				break;
			case "sum":
				if (Number.isInteger(acc.sum) && !Number.isSafeInteger(acc.sum)) {
					throw new ToolError(
						"LIMIT_EXCEEDED",
						'aggregate "sum" exceeds the safe integer range',
					);
				}
				out[acc.as] = acc.sum;
				break;
			case "min":
			case "max":
				if (acc.count === 0) {
					throw new ToolError(
						"INVALID_ARGUMENT",
						`aggregate "${acc.fn}" has no numeric values`,
					);
				}
				out[acc.as] = acc.fn === "min" ? acc.min : acc.max;
				break;
			case "avg": {
				if (acc.count === 0) {
					throw new ToolError(
						"INVALID_ARGUMENT",
						'aggregate "avg" has no numeric values',
					);
				}
				const avg = acc.sum / acc.count;
				if (!Number.isFinite(avg)) {
					throw new ToolError(
						"LIMIT_EXCEEDED",
						'aggregate "avg" produced a non-finite result',
					);
				}
				out[acc.as] = avg;
				break;
			}
		}
	}
	return out;
}

export function aggregateRecords(
	records: JsonValue[],
	aggregates: Aggregate[],
): Record<string, JsonValue> {
	const accs = newAggregateAccs(aggregates);
	for (const r of records) foldAggregateAccs(accs, r);
	return finalizeAggregateAccs(accs);
}

export function sortRows(
	rows: Record<string, JsonValue>[],
	orderBy: OrderBy[],
): Record<string, JsonValue>[] {
	return [...rows].sort((a, b) => {
		for (const ob of orderBy) {
			const c = compareScalars(a[ob.field], b[ob.field]);
			if (c !== 0) return ob.direction === "asc" ? c : -c;
		}
		return 0;
	});
}
