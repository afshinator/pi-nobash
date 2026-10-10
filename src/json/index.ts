import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { JSON_TOOL_NAME, JSONL_TOOL_NAME } from "../constants.ts";
import { runJsonQuery } from "./json-query.ts";
import { runQueryJsonl } from "./jsonl-query.ts";
import {
	JsonlQueryInputSchema,
	JsonlQueryOutputSchema,
	JsonQueryInputSchema,
	JsonQueryOutputSchema,
} from "./schemas.ts";

export function registerJsonTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: JSON_TOOL_NAME,
		label: "JSON query",
		description:
			"Read and query one JSON document using a typed operator set (filter, project, aggregate, order, limit). No expression or code input.",
		promptSnippet:
			"Query one JSON file with bounded filter/project/aggregate/order/limit operators.",
		parameters: JsonQueryInputSchema,
		outputSchema: JsonQueryOutputSchema,
		exposure: "direct",
		defaultActive: false,
		annotations: { readOnlyHint: true },
		execute: async (_id, params, _signal, _onUpdate, ctx) =>
			runJsonQuery(params, ctx.cwd),
	});

	pi.registerTool({
		name: JSONL_TOOL_NAME,
		label: "JSONL query",
		description:
			"Stream a JSONL file and apply bounded filter/project/group/aggregate/order/limit operations without loading the whole file into context.",
		promptSnippet:
			"Stream a JSONL file with bounded filter/group/aggregate/order/limit operations.",
		parameters: JsonlQueryInputSchema,
		outputSchema: JsonlQueryOutputSchema,
		exposure: "direct",
		defaultActive: false,
		annotations: { readOnlyHint: true },
		execute: async (_id, params, _signal, _onUpdate, ctx) =>
			runQueryJsonl(params, ctx.cwd),
	});
}
