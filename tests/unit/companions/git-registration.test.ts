import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerGitMutationTools } from "../../../companions/git/index.ts";

type AnyTool = {
	name: string;
	promptSnippet?: string;
	exposure?: string;
	defaultActive?: boolean;
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
	parameters?: { properties?: Record<string, unknown> };
};

const FORBIDDEN_FIELDS = new Set([
	"command",
	"argv",
	"script",
	"executable",
	"program",
	"args",
	"flags",
	"cmd",
]);

function collectTools(): AnyTool[] {
	const tools: AnyTool[] = [];
	const pi = { registerTool: (t: AnyTool) => tools.push(t), on: () => {} };
	registerGitMutationTools(pi as never);
	return tools;
}

test("registerGitMutationTools registers exactly the git mutation tools", () => {
	const tools = collectTools();
	assert.deepEqual(
		tools.map((t) => t.name).sort(),
		[
			"git_add",
			"git_commit",
			"git_create_branch",
			"git_push",
			"git_rm_cached",
		].sort(),
	);
});

test("every git mutation tool: direct exposure, inactive by default, one-line promptSnippet", () => {
	for (const tool of collectTools()) {
		assert.equal(tool.exposure, "direct", tool.name);
		assert.equal(tool.defaultActive, false, tool.name);
		assert.ok(
			typeof tool.promptSnippet === "string" &&
				tool.promptSnippet.length > 0 &&
				!tool.promptSnippet.includes("\n"),
			`${tool.name} needs a one-line promptSnippet`,
		);
	}
});

test("every git mutation tool mutates (readOnlyHint false); git_push and git_rm_cached are destructive", () => {
	for (const tool of collectTools()) {
		assert.equal(
			tool.annotations?.readOnlyHint,
			false,
			`${tool.name} mutates; readOnlyHint must be false`,
		);
		assert.equal(
			tool.annotations?.destructiveHint === true,
			tool.name === "git_push" || tool.name === "git_rm_cached",
			`destructiveHint must be true only on git_push and git_rm_cached (${tool.name})`,
		);
	}
});

test("no git mutation schema has a command/argv/script/executable field", () => {
	for (const tool of collectTools()) {
		const def = tool as unknown as ToolDefinition<never>;
		const props =
			(def.parameters as { properties?: Record<string, unknown> }).properties ??
			{};
		for (const key of Object.keys(props)) {
			assert.ok(
				!FORBIDDEN_FIELDS.has(key),
				`${tool.name}.parameters.${key} is a forbidden generic-execution field`,
			);
		}
	}
});
