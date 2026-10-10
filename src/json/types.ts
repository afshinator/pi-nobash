import type { JsonValue } from "../errors.ts";

/** Shared typed operator element shapes (C2/A4). */

export type JsonScalar = string | number | boolean | null;
export type JsonPathSegment = { key: string } | { index: number };
export type JsonPath = JsonPathSegment[];

export type PredicateOp =
	| "eq"
	| "ne"
	| "lt"
	| "lte"
	| "gt"
	| "gte"
	| "exists"
	| "is_null"
	| "in"
	| "contains_string";

export type Predicate = { path: JsonPath; op: PredicateOp; value?: JsonValue };

export type Selection = { as: string; path: JsonPath };

export type AggregateFn = "count" | "sum" | "min" | "max" | "avg";
export type Aggregate = { as: string; fn: AggregateFn; path?: JsonPath };

export type OrderBy = { field: string; direction: "asc" | "desc" };
