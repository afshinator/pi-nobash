import { type JsonValue, ToolError } from "../errors.ts";
import { getPath } from "./paths.ts";
import type { Aggregate, JsonPath } from "./types.ts";

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
