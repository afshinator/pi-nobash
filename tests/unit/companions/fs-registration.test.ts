import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerFileTools } from "../../../companions/files/index.ts";

type AnyTool = {
	name: string;
	promptSnippet?: string;
	exposure?: string;
	defaultActive?: boolean;
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

test("registerFileTools registers exactly fs_copy and fs_move with companion metadata", () => {
	const tools: AnyTool[] = [];
	const pi = {
		registerTool: (t: AnyTool) => tools.push(t),
		registerCommand: () => {},
		on: () => {},
	} as unknown as ExtensionAPI;
	registerFileTools(pi);
	assert.deepEqual(tools.map((t) => t.name).sort(), ["fs_copy", "fs_move"]);
	for (const t of tools) {
		assert.equal(t.exposure, "direct");
		assert.equal(t.defaultActive, false);
		assert.ok(t.promptSnippet && !t.promptSnippet.includes("\n"));
		assert.equal(t.annotations?.readOnlyHint, false);
		assert.equal(t.annotations?.destructiveHint, true);
	}
});
