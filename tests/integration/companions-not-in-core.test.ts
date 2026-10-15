import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerExpoTools } from "../../companions/expo/index.ts";
import { registerGitMutationTools } from "../../companions/git/index.ts";
import { registerJsTools } from "../../companions/javascript/index.ts";
import { registerPythonTools } from "../../companions/python/index.ts";

type AnyTool = {
	name: string;
	promptSnippet?: string;
	exposure?: string;
	defaultActive?: boolean;
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

function fakePi(): { pi: ExtensionAPI; tools: AnyTool[] } {
	const tools: AnyTool[] = [];
	const pi = {
		registerTool: (t: AnyTool) => tools.push(t),
		registerCommand: () => {},
		on: () => {},
	};
	return { pi: pi as unknown as ExtensionAPI, tools };
}

const CORE_ENTRY = "../../extensions/pi-nobash.ts";

const SEVEN_CORE = [
	"json_query",
	"query_jsonl",
	"git_status",
	"git_diff",
	"git_log",
	"git_show",
	"run_validation",
];

const COMPANION_NAMES = [
	"git_create_branch",
	"git_add",
	"git_commit",
	"git_push",
	"js_format_write",
	"py_format_write",
	"js_lint_fix",
	"py_lint_fix",
	"js_dep_add",
	"js_dep_remove",
	"expo_dep_add",
	"py_dep_add",
	"py_dep_remove",
];

test("D3: loading the real core entry registers exactly the seven packaged tools and no companion tool", async () => {
	const { default: factory } = (await import(CORE_ENTRY)) as {
		default: (pi: ExtensionAPI) => void;
	};
	const { pi, tools } = fakePi();
	factory(pi);
	const names = tools.map((t) => t.name).sort();
	assert.deepEqual(names, [...SEVEN_CORE].sort());
	for (const companion of COMPANION_NAMES) {
		assert.ok(
			!names.includes(companion),
			`core entry must not register companion tool ${companion}`,
		);
	}
});

test("D3: companion tools appear only when each companion index is loaded", async () => {
	// Fresh fake pi per companion; core entry is not loaded here.
	const { pi, tools } = fakePi();
	registerGitMutationTools(pi);
	registerJsTools(pi);
	registerPythonTools(pi);
	assert.deepEqual(
		tools.map((t) => t.name).sort(),
		[
			"git_add",
			"git_commit",
			"git_create_branch",
			"git_push",
			"js_format_write",
			"js_lint_fix",
			"js_dep_add",
			"js_dep_remove",
			"py_format_write",
			"py_lint_fix",
			"py_dep_add",
			"py_dep_remove",
		].sort(),
	);
	for (const tool of tools) {
		assert.equal(tool.exposure, "direct", `${tool.name} exposure`);
		assert.equal(tool.defaultActive, false, `${tool.name} defaultActive`);
		assert.ok(
			typeof tool.promptSnippet === "string" &&
				tool.promptSnippet.length > 0 &&
				!tool.promptSnippet.includes("\n"),
			`${tool.name} needs a one-line promptSnippet`,
		);
		assert.equal(
			tool.annotations?.readOnlyHint,
			false,
			`${tool.name} mutates; readOnlyHint must be false`,
		);
	}
});

test("D3: each companion registers only its own tool names (per-companion fresh pi)", async () => {
	const cases: Array<[string, (pi: ExtensionAPI) => void, string[]]> = [
		[
			"companions/git/index.ts",
			(pi) => registerGitMutationTools(pi),
			["git_create_branch", "git_add", "git_commit", "git_push"],
		],
		[
			"companions/javascript/index.ts",
			(pi) => registerJsTools(pi),
			["js_format_write", "js_lint_fix", "js_dep_add", "js_dep_remove"],
		],
		[
			"companions/expo/index.ts",
			(pi) => registerExpoTools(pi),
			["expo_dep_add"],
		],
		[
			"companions/python/index.ts",
			(pi) => registerPythonTools(pi),
			["py_format_write", "py_lint_fix", "py_dep_add", "py_dep_remove"],
		],
	];
	// Fresh pi per companion: registering one companion must register exactly
	// its own names — no other companion's tools leak into the same loader.
	for (const [label, load, expected] of cases) {
		const { pi, tools } = fakePi();
		load(pi);
		assert.deepEqual(
			tools.map((t) => t.name).sort(),
			[...expected].sort(),
			label,
		);
	}
});
