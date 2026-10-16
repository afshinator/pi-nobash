import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_STRUCTURED_ROWS,
	MAX_JSONL_GROUPS,
	MAX_JSONL_LINE_BYTES,
	MAX_JSONL_ROWS,
} from "../constants.ts";
import {
	type JsonValue,
	runTruncatingTool,
	ToolError,
	type ToolErrorDetails,
} from "../errors.ts";
import { validateWorkspaceFile } from "../path-policy.ts";
import {
	type AggregateAcc,
	finalizeAggregateAccs,
	foldAggregateAccs,
	newAggregateAccs,
} from "./aggregates.ts";
import { getPath } from "./paths.ts";
import {
	assertSafeNumbers,
	matchesAll,
	validatePredicates,
} from "./predicates.ts";
import {
	limitResults,
	projectRecord,
	sortRows,
	validateQueryShape,
} from "./rows.ts";
import type { JsonlQueryInput } from "./schemas.ts";
import type { Aggregate, OrderBy, Selection } from "./types.ts";

export type JsonlQueryDetails = {
	scannedLines: number;
	parsedLines: number;
	skippedMalformedLines: number;
	matchedLines: number;
	returnedRows: number;
	truncated: boolean;
	results: JsonValue[];
};

type Body = AgentToolResult<JsonlQueryDetails | ToolErrorDetails>;

type LineReader = ReturnType<typeof createInterface>;

type LineStats = {
	scannedLines: number;
	parsedLines: number;
	skippedMalformedLines: number;
	matchedLines: number;
};

type GroupEntry = { by: Record<string, JsonValue>; accs: AggregateAcc[] };

function groupKey(record: JsonValue, groupBy: Selection[]): string {
	return JSON.stringify(
		groupBy.map((g) => {
			const lookup = getPath(record, g.path);
			return lookup.found ? { f: 1, v: lookup.value } : { f: 0 };
		}),
	);
}

function validateJsonlQuery(params: JsonlQueryInput): void {
	validatePredicates(params.where ?? []);
	validateQueryShape(params.select, params.aggregate, params.orderBy);
	if (params.groupBy !== undefined && params.select !== undefined) {
		throw new ToolError(
			"INVALID_ARGUMENT",
			"select cannot be combined with groupBy",
		);
	}
	if (params.groupBy !== undefined) {
		const seen = new Set<string>();
		for (const g of params.groupBy) {
			if (seen.has(g.as))
				throw new ToolError("INVALID_ARGUMENT", `duplicate alias: ${g.as}`);
			seen.add(g.as);
		}
	}
}

/** Byte-limit and JSON-parse one line; undefined means "skipped malformed line". */
function parseJsonlLine(
	line: string,
	lineNumber: number,
	malformedLine: JsonlQueryInput["malformedLine"],
	rl: LineReader,
): JsonValue | undefined {
	if (Buffer.byteLength(line, "utf8") > MAX_JSONL_LINE_BYTES) {
		rl.close();
		throw new ToolError(
			"LIMIT_EXCEEDED",
			`JSONL line exceeds ${MAX_JSONL_LINE_BYTES} bytes`,
		);
	}
	let parsed: JsonValue;
	try {
		parsed = JSON.parse(line) as JsonValue;
	} catch (e) {
		if (malformedLine === "skip") return undefined;
		rl.close();
		throw new ToolError(
			"PARSE_ERROR",
			`invalid JSONL line ${lineNumber}: ${(e as Error).message}`,
		);
	}
	assertSafeNumbers(parsed);
	return parsed;
}

/** Group-branch record handling: find-or-create the group, then fold aggregates. */
function foldGroupRecord(
	record: JsonValue,
	groupBy: Selection[],
	aggregate: Aggregate[] | undefined,
	groups: Map<string, GroupEntry>,
	rl: LineReader,
): void {
	const key = groupKey(record, groupBy);
	let entry = groups.get(key);
	if (entry === undefined) {
		if (groups.size >= MAX_JSONL_GROUPS) {
			rl.close();
			throw new ToolError(
				"LIMIT_EXCEEDED",
				`distinct groups exceed ${MAX_JSONL_GROUPS}`,
			);
		}
		entry = {
			by: projectRecord(record, groupBy),
			accs: newAggregateAccs(aggregate ?? []),
		};
		groups.set(key, entry);
	}
	if (aggregate !== undefined) foldAggregateAccs(entry.accs, record);
}

/** Flat-branch record handling: select-projected or passthrough row. */
function pushRowRecord(
	record: JsonValue,
	select: Selection[] | undefined,
	hasOrderBy: boolean,
	limit: number,
	orderBuffer: Record<string, JsonValue>[],
	flatResults: JsonValue[],
	rl: LineReader,
): void {
	if (select !== undefined) {
		const row = projectRecord(record, select);
		if (hasOrderBy) {
			if (orderBuffer.length >= MAX_JSONL_ROWS) {
				rl.close();
				throw new ToolError(
					"LIMIT_EXCEEDED",
					`matched rows to sort exceed ${MAX_JSONL_ROWS}`,
				);
			}
			orderBuffer.push(row);
		} else if (flatResults.length < limit) flatResults.push(row);
	} else if (flatResults.length < limit) {
		flatResults.push(record);
	}
}

function buildGroupedResult(
	stats: LineStats,
	groups: Map<string, GroupEntry>,
	hasAggregate: boolean,
	orderBy: OrderBy[] | undefined,
	limit: number,
): JsonlQueryDetails {
	let rows = [...groups.values()].map((g) => ({
		...g.by,
		...(hasAggregate ? finalizeAggregateAccs(g.accs) : {}),
	}));
	if (orderBy !== undefined) rows = sortRows(rows, orderBy);
	const { returned, truncated, results } = limitResults(rows, limit);
	return {
		...stats,
		returnedRows: returned,
		truncated,
		results,
	};
}

function buildAggregateResult(
	stats: LineStats,
	accs: AggregateAcc[],
): JsonlQueryDetails {
	const row = finalizeAggregateAccs(accs);
	return { ...stats, returnedRows: 1, truncated: false, results: [row] };
}

function buildFlatResult(
	stats: LineStats,
	orderBuffer: Record<string, JsonValue>[],
	flatResults: JsonValue[],
	orderBy: OrderBy[] | undefined,
	limit: number,
): JsonlQueryDetails {
	const rows =
		orderBy !== undefined ? sortRows(orderBuffer, orderBy) : flatResults;
	const { returned, results } = limitResults(rows, limit);
	return {
		...stats,
		returnedRows: returned,
		truncated: stats.matchedLines > limit,
		results,
	};
}

async function impl(
	params: JsonlQueryInput,
	cwd: string,
): Promise<JsonlQueryDetails> {
	const file = validateWorkspaceFile(cwd, params.path);
	validateJsonlQuery(params);

	const where = params.where ?? [];
	const select = params.select;
	const groupBy = params.groupBy;
	const aggregate = params.aggregate;
	const orderBy = params.orderBy;

	const limit = params.limit ?? DEFAULT_STRUCTURED_ROWS;
	const hasGroupBy = groupBy !== undefined;
	const hasAggregate = aggregate !== undefined;
	const hasOrderBy = orderBy !== undefined;

	const stats: LineStats = {
		scannedLines: 0,
		parsedLines: 0,
		skippedMalformedLines: 0,
		matchedLines: 0,
	};
	const flatResults: JsonValue[] = [];
	const orderBuffer: Record<string, JsonValue>[] = [];
	const accs: AggregateAcc[] | null =
		hasAggregate && !hasGroupBy ? newAggregateAccs(aggregate) : null;
	const groups = new Map<string, GroupEntry>();

	const rl = createInterface({
		input: createReadStream(file),
		crlfDelay: Infinity,
	});
	for await (const line of rl) {
		stats.scannedLines += 1;
		const parsed = parseJsonlLine(
			line,
			stats.scannedLines,
			params.malformedLine,
			rl,
		);
		if (parsed === undefined) {
			stats.skippedMalformedLines += 1;
			continue;
		}
		stats.parsedLines += 1;
		if (!matchesAll(parsed, where)) continue;
		stats.matchedLines += 1;

		if (hasGroupBy) {
			foldGroupRecord(parsed, groupBy, aggregate, groups, rl);
			continue;
		}
		if (accs !== null) {
			foldAggregateAccs(accs, parsed);
			continue;
		}
		pushRowRecord(
			parsed,
			select,
			hasOrderBy,
			limit,
			orderBuffer,
			flatResults,
			rl,
		);
	}

	if (hasGroupBy)
		return buildGroupedResult(stats, groups, hasAggregate, orderBy, limit);
	if (accs !== null) return buildAggregateResult(stats, accs);
	return buildFlatResult(stats, orderBuffer, flatResults, orderBy, limit);
}

export function runQueryJsonl(
	params: JsonlQueryInput,
	cwd: string,
): Promise<Body> {
	return runTruncatingTool(
		() => impl(params, cwd),
		(details, truncated) =>
			`${details.returnedRows} of ${details.matchedLines} matched, ` +
			`${details.scannedLines} scanned${details.truncated || truncated ? " [truncated]" : ""}`,
	);
}
