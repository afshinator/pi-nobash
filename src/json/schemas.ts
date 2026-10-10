import type { Static } from "typebox";
import { Type } from "typebox";
import {
	MAX_AGGREGATES,
	MAX_ORDER_BY,
	MAX_PREDICATES,
	MAX_SELECTIONS,
	MAX_STRUCTURED_ROWS,
} from "../constants.ts";

const PathSegmentSchema = Type.Union([
	Type.Object({ key: Type.String() }, { additionalProperties: false }),
	Type.Object({ index: Type.Integer() }, { additionalProperties: false }),
]);

const JsonPathSchema = Type.Array(PathSegmentSchema);

const PredicateOpSchema = Type.Union([
	Type.Literal("eq"),
	Type.Literal("ne"),
	Type.Literal("lt"),
	Type.Literal("lte"),
	Type.Literal("gt"),
	Type.Literal("gte"),
	Type.Literal("exists"),
	Type.Literal("is_null"),
	Type.Literal("in"),
	Type.Literal("contains_string"),
]);

const PredicateSchema = Type.Object(
	{
		path: JsonPathSchema,
		op: PredicateOpSchema,
		value: Type.Optional(Type.Any()),
	},
	{ additionalProperties: false },
);

const SelectionSchema = Type.Object(
	{ as: Type.String(), path: JsonPathSchema },
	{ additionalProperties: false },
);

const AggregateFnSchema = Type.Union([
	Type.Literal("count"),
	Type.Literal("sum"),
	Type.Literal("min"),
	Type.Literal("max"),
	Type.Literal("avg"),
]);

const AggregateSchema = Type.Object(
	{
		as: Type.String(),
		fn: AggregateFnSchema,
		path: Type.Optional(JsonPathSchema),
	},
	{ additionalProperties: false },
);

const OrderBySchema = Type.Object(
	{
		field: Type.String(),
		direction: Type.Union([Type.Literal("asc"), Type.Literal("desc")]),
	},
	{ additionalProperties: false },
);

export const JsonQueryInputSchema = Type.Object(
	{
		path: Type.String(),
		root: Type.Optional(JsonPathSchema),
		where: Type.Optional(
			Type.Array(PredicateSchema, { maxItems: MAX_PREDICATES }),
		),
		select: Type.Optional(
			Type.Array(SelectionSchema, { maxItems: MAX_SELECTIONS }),
		),
		aggregate: Type.Optional(
			Type.Array(AggregateSchema, { maxItems: MAX_AGGREGATES }),
		),
		orderBy: Type.Optional(
			Type.Array(OrderBySchema, { maxItems: MAX_ORDER_BY }),
		),
		limit: Type.Optional(
			Type.Integer({ minimum: 1, maximum: MAX_STRUCTURED_ROWS }),
		),
	},
	{ additionalProperties: false },
);

export const JsonlQueryInputSchema = Type.Object(
	{
		path: Type.String(),
		malformedLine: Type.Union([Type.Literal("error"), Type.Literal("skip")]),
		where: Type.Optional(
			Type.Array(PredicateSchema, { maxItems: MAX_PREDICATES }),
		),
		select: Type.Optional(
			Type.Array(SelectionSchema, { maxItems: MAX_SELECTIONS }),
		),
		groupBy: Type.Optional(
			Type.Array(SelectionSchema, { maxItems: MAX_SELECTIONS }),
		),
		aggregate: Type.Optional(
			Type.Array(AggregateSchema, { maxItems: MAX_AGGREGATES }),
		),
		orderBy: Type.Optional(
			Type.Array(OrderBySchema, { maxItems: MAX_ORDER_BY }),
		),
		limit: Type.Optional(
			Type.Integer({ minimum: 1, maximum: MAX_STRUCTURED_ROWS }),
		),
	},
	{ additionalProperties: false },
);

export type JsonQueryInput = Static<typeof JsonQueryInputSchema>;
export type JsonlQueryInput = Static<typeof JsonlQueryInputSchema>;

export const JsonQueryOutputSchema = Type.Object(
	{
		matched: Type.Integer(),
		returned: Type.Integer(),
		truncated: Type.Boolean(),
		results: Type.Array(Type.Any()),
	},
	{ additionalProperties: false },
);

export const JsonlQueryOutputSchema = Type.Object(
	{
		scannedLines: Type.Integer(),
		parsedLines: Type.Integer(),
		skippedMalformedLines: Type.Integer(),
		matchedLines: Type.Integer(),
		returnedRows: Type.Integer(),
		truncated: Type.Boolean(),
		results: Type.Array(Type.Any()),
	},
	{ additionalProperties: false },
);
