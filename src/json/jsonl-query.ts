import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_STRUCTURED_ROWS,
	MAX_JSONL_GROUPS,
	MAX_JSONL_LINE_BYTES,
	MAX_JSONL_ROWS,
	MAX_RESULT_TEXT_BYTES,
} from "../constants.ts";
import {
	type JsonValue,
	runTool,
	successResult,
	ToolError,
	type ToolErrorDetails,
	truncateUtf8,
} from "../errors.ts";
import { validateWorkspaceFile } from "../path-policy.ts";
import {
	type AggregateAcc,
	assertSafeNumbers,
	finalizeAggregateAccs,
	foldAggregateAccs,
	getPath,
	matchesAll,
	newAggregateAccs,
	projectRecord,
	sortRows,
	validatePredicates,
	validateQueryShape,
} from "./operators.ts";
import type { JsonlQueryInput } from "./schemas.ts";
import type { Selection } from "./types.ts";

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

function groupKey(record: JsonValue, groupBy: Selection[]): string {
	return JSON.stringify(
		groupBy.map((g) => {
			const lookup = getPath(record, g.path);
			return lookup.found ? { f: 1, v: lookup.value } : { f: 0 };
		}),
	);
}

async function impl(
	params: JsonlQueryInput,
	cwd: string,
): Promise<JsonlQueryDetails> {
	const file = validateWorkspaceFile(cwd, params.path);
	const where = params.where ?? [];
	const select = params.select;
	const groupBy = params.groupBy;
	const aggregate = params.aggregate;
	const orderBy = params.orderBy;

	validatePredicates(where);
	validateQueryShape(select, aggregate, orderBy);
	if (groupBy !== undefined && select !== undefined) {
		throw new ToolError(
			"INVALID_ARGUMENT",
			"select cannot be combined with groupBy",
		);
	}
	if (groupBy !== undefined) {
		const seen = new Set<string>();
		for (const g of groupBy) {
			if (seen.has(g.as))
				throw new ToolError("INVALID_ARGUMENT", `duplicate alias: ${g.as}`);
			seen.add(g.as);
		}
	}

	const limit = params.limit ?? DEFAULT_STRUCTURED_ROWS;
	const hasGroupBy = groupBy !== undefined;
	const hasAggregate = aggregate !== undefined;
	const hasOrderBy = orderBy !== undefined;

	let scannedLines = 0;
	let parsedLines = 0;
	let skippedMalformedLines = 0;
	let matchedLines = 0;

	const flatResults: JsonValue[] = [];
	const orderBuffer: Record<string, JsonValue>[] = [];
	const accs: AggregateAcc[] | null =
		hasAggregate && !hasGroupBy ? newAggregateAccs(aggregate) : null;
	const groups = new Map<
		string,
		{ by: Record<string, JsonValue>; accs: AggregateAcc[] }
	>();

	const rl = createInterface({
		input: createReadStream(file),
		crlfDelay: Infinity,
	});
	for await (const line of rl) {
		scannedLines += 1;
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
			if (params.malformedLine === "skip") {
				skippedMalformedLines += 1;
				continue;
			}
			rl.close();
			throw new ToolError(
				"PARSE_ERROR",
				`invalid JSONL line ${scannedLines}: ${(e as Error).message}`,
			);
		}
		assertSafeNumbers(parsed);
		parsedLines += 1;
		if (!matchesAll(parsed, where)) continue;
		matchedLines += 1;

		if (hasGroupBy) {
			const key = groupKey(parsed, groupBy);
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
					by: projectRecord(parsed, groupBy),
					accs: newAggregateAccs(aggregate ?? []),
				};
				groups.set(key, entry);
			}
			if (hasAggregate) foldAggregateAccs(entry.accs, parsed);
			continue;
		}

		if (accs !== null) {
			foldAggregateAccs(accs, parsed);
			continue;
		}

		if (select !== undefined) {
			const row = projectRecord(parsed, select);
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
			flatResults.push(parsed);
		}
	}

	if (hasGroupBy) {
		let rows = [...groups.values()].map((g) => ({
			...g.by,
			...(hasAggregate ? finalizeAggregateAccs(g.accs) : {}),
		}));
		if (hasOrderBy) rows = sortRows(rows, orderBy);
		const truncated = rows.length > limit;
		return {
			scannedLines,
			parsedLines,
			skippedMalformedLines,
			matchedLines,
			returnedRows: Math.min(rows.length, limit),
			truncated,
			results: rows.slice(0, limit),
		};
	}

	if (accs !== null) {
		const row = finalizeAggregateAccs(accs);
		return {
			scannedLines,
			parsedLines,
			skippedMalformedLines,
			matchedLines,
			returnedRows: 1,
			truncated: false,
			results: [row],
		};
	}

	const results = hasOrderBy ? sortRows(orderBuffer, orderBy) : flatResults;
	const truncated = matchedLines > limit;
	return {
		scannedLines,
		parsedLines,
		skippedMalformedLines,
		matchedLines,
		returnedRows: Math.min(results.length, limit),
		truncated,
		results: results.slice(0, limit),
	};
}

export function runQueryJsonl(
	params: JsonlQueryInput,
	cwd: string,
): Promise<Body> {
	return runTool(async () => {
		const details = await impl(params, cwd);
		const { text: body, truncated } = truncateUtf8(
			JSON.stringify(details.results),
			MAX_RESULT_TEXT_BYTES,
		);
		const text =
			`${details.returnedRows} of ${details.matchedLines} matched, ` +
			`${details.scannedLines} scanned${details.truncated || truncated ? " [truncated]" : ""}\n${body}`;
		return successResult(text, details, details);
	});
}
