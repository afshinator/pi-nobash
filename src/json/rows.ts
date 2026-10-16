import { type JsonValue, ToolError } from "../errors.ts";
import { getPath } from "./paths.ts";
import type { Aggregate, OrderBy, Selection } from "./types.ts";

/** Rank in the deterministic total order: missing/null < boolean < number < string < other. */
const TYPE_RANK: Record<string, number> = {
	undefined: 0,
	boolean: 1,
	number: 2,
	string: 3,
};

function rankOf(v: JsonValue | undefined): number {
	if (v === null) return 0;
	return TYPE_RANK[typeof v] ?? 4;
}

/** Three-way compare for one comparable kind (both numbers or both strings). */
function compareThreeWay(a: number | string, b: number | string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Deterministic total order for projected scalar fields (missing/null sort together). */
export function compareScalars(
	a: JsonValue | undefined,
	b: JsonValue | undefined,
): number {
	const ra = rankOf(a);
	const rb = rankOf(b);
	if (ra !== rb) return ra - rb;
	if (ra === 1) return Number(a) - Number(b);
	if (ra === 2 || ra === 3) return compareThreeWay(a as number, b as number);
	return 0;
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

/** Shared final-limit shape for the JSON and JSONL query result blocks. */
export function limitResults(
	results: JsonValue[],
	limit: number,
): { returned: number; truncated: boolean; results: JsonValue[] } {
	return {
		returned: Math.min(results.length, limit),
		truncated: results.length > limit,
		results: results.slice(0, limit),
	};
}
