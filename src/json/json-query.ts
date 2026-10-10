import { readFileSync } from "node:fs";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_STRUCTURED_ROWS,
	MAX_JSON_INPUT_BYTES,
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
	aggregateRecords,
	assertSafeNumbers,
	getPath,
	matchesAll,
	projectRecord,
	sortRows,
	validatePredicates,
	validateQueryShape,
} from "./operators.ts";
import type { JsonQueryInput } from "./schemas.ts";

export type JsonQueryDetails = {
	matched: number;
	returned: number;
	truncated: boolean;
	results: JsonValue[];
};

type Body = AgentToolResult<JsonQueryDetails | ToolErrorDetails>;

async function impl(
	params: JsonQueryInput,
	cwd: string,
): Promise<JsonQueryDetails> {
	const where = params.where ?? [];
	const select = params.select;
	const aggregate = params.aggregate;
	const orderBy = params.orderBy;
	const file = validateWorkspaceFile(cwd, params.path);
	const buf = readFileSync(file);
	if (buf.length > MAX_JSON_INPUT_BYTES) {
		throw new ToolError(
			"LIMIT_EXCEEDED",
			`JSON file exceeds ${MAX_JSON_INPUT_BYTES} bytes`,
		);
	}
	let doc: JsonValue;
	try {
		doc = JSON.parse(buf.toString("utf8")) as JsonValue;
	} catch (e) {
		throw new ToolError("PARSE_ERROR", `invalid JSON: ${(e as Error).message}`);
	}
	assertSafeNumbers(doc);

	let rootValue: JsonValue = doc;
	if (params.root !== undefined) {
		const lookup = getPath(doc, params.root);
		if (!lookup.found) throw new ToolError("NOT_FOUND", "root path not found");
		rootValue = lookup.value;
	}

	const records: JsonValue[] = Array.isArray(rootValue)
		? rootValue
		: [rootValue];

	validatePredicates(where);
	validateQueryShape(select, aggregate, orderBy);
	if (select !== undefined && aggregate !== undefined) {
		throw new ToolError(
			"INVALID_ARGUMENT",
			"select and aggregate cannot be combined",
		);
	}

	const matched = records.filter((r) => matchesAll(r, where));

	if (aggregate !== undefined) {
		const row = aggregateRecords(matched, aggregate);
		return {
			matched: matched.length,
			returned: 1,
			truncated: false,
			results: [row],
		};
	}

	let results: JsonValue[];
	if (select !== undefined) {
		let rows = matched.map((r) => projectRecord(r, select));
		if (orderBy !== undefined) rows = sortRows(rows, orderBy);
		results = rows;
	} else {
		results = matched;
	}

	const limit = params.limit ?? DEFAULT_STRUCTURED_ROWS;
	const truncated = results.length > limit;
	return {
		matched: matched.length,
		returned: Math.min(results.length, limit),
		truncated,
		results: results.slice(0, limit),
	};
}

export function runJsonQuery(
	params: JsonQueryInput,
	cwd: string,
): Promise<Body> {
	return runTool(async () => {
		const details = await impl(params, cwd);
		const { text: body, truncated } = truncateUtf8(
			JSON.stringify(details.results),
			MAX_RESULT_TEXT_BYTES,
		);
		const text = `${details.returned} of ${details.matched} matched${details.truncated || truncated ? " [truncated]" : ""}\n${body}`;
		return successResult(text, details, details);
	});
}
