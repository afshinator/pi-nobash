import assert from "node:assert/strict";
import { test } from "node:test";
import { moveTool } from "../../../companions/files/move.ts";

type AnyTool = {
	parameters: { properties: Record<string, unknown> };
	exposure?: string;
	defaultActive?: boolean;
	promptSnippet?: string;
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

const tool = moveTool as unknown as AnyTool;

test("fs_move schema: exactly { from, to }, no command/argv/script/program/flag field", () => {
	const keys = Object.keys(tool.parameters.properties).sort();
	assert.deepEqual(keys, ["from", "to"]);
	for (const forbidden of [
		"command",
		"argv",
		"script",
		"program",
		"flag",
		"paths",
		"recursive",
		"overwrite",
		"force",
	]) {
		assert.ok(
			!(forbidden in tool.parameters.properties),
			`fs_move must not expose "${forbidden}"`,
		);
	}
});

test("fs_move metadata: exposure direct, defaultActive false, one-line promptSnippet, destructive", () => {
	assert.equal(tool.exposure, "direct");
	assert.equal(tool.defaultActive, false);
	assert.ok(tool.promptSnippet && !tool.promptSnippet.includes("\n"));
	assert.equal(tool.annotations?.readOnlyHint, false);
	assert.equal(tool.annotations?.destructiveHint, true);
});
