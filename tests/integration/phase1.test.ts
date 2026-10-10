import assert from "node:assert/strict";
import { test } from "node:test";
import piNoBash from "../../extensions/pi-nobash.ts";
import {
	PACKAGE_NAME,
	PACKAGE_VERSION,
	REPLACEMENT_TOOL_NAMES,
	STATUS_COMMAND_NAME,
	TARGET_PI,
} from "../../src/constants.ts";
import {
	errorResult,
	InternalError,
	successResult,
	ToolError,
	toToolErrorResult,
	truncateUtf8,
} from "../../src/errors.ts";
import {
	assertSafeRelativeGitPath,
	PathPolicyError,
	validateWorkspacePath,
} from "../../src/path-policy.ts";
import { BASH_BLOCK_REASON, registerBashBlocker } from "../../src/pi-guard.ts";
import { buildStatusReport, registerStatusCommand } from "../../src/status.ts";
import { createMockPi } from "./helpers.ts";

const FORBIDDEN_PARAMS = new Set([
	"command",
	"argv",
	"script",
	"program",
	"code",
	"executable",
	"shell",
]);

function collectPropertyNames(
	schema: unknown,
	out: Set<string> = new Set(),
): Set<string> {
	if (typeof schema !== "object" || schema === null) return out;
	const s = schema as Record<string, unknown>;
	if (typeof s.properties === "object" && s.properties !== null) {
		for (const key of Object.keys(s.properties as Record<string, unknown>))
			out.add(key);
	}
	for (const key of [
		"properties",
		"items",
		"additionalProperties",
		"anyOf",
		"allOf",
		"oneOf",
	]) {
		const v = s[key];
		if (Array.isArray(v)) for (const item of v) collectPropertyNames(item, out);
		else if (typeof v === "object" && v !== null) collectPropertyNames(v, out);
	}
	return out;
}

test("errors: expected errors use the C3 envelope (isError, CODE prefix, details)", () => {
	const result = errorResult("NOT_FOUND", "no such file");
	assert.equal(result.isError, true);
	const c0 = result.content[0];
	assert.equal(c0?.type, "text");
	assert.equal(
		c0?.type === "text" ? c0.text : undefined,
		"NOT_FOUND: no such file",
	);
	assert.deepEqual(result.details, {
		code: "NOT_FOUND",
		message: "no such file",
	});
});

test("errors: success result carries details and optional structuredContent", () => {
	const result = successResult("ok", { rows: 1 }, { rows: 1 });
	assert.equal(result.isError, undefined);
	const s0 = result.content[0];
	assert.equal(s0?.type === "text" ? s0.text : undefined, "ok");
	assert.deepEqual(result.details, { rows: 1 });
	assert.deepEqual(result.structuredContent, { rows: 1 });
});

test("errors: ToolError maps to envelope, InternalError is rethrown", () => {
	assert.throws(
		() => toToolErrorResult(new InternalError("boom")),
		InternalError,
	);
	const mapped = toToolErrorResult(
		new ToolError("CAPABILITY_GAP", "unsupported", "join"),
	);
	assert.equal(mapped.isError, true);
	assert.equal(mapped.details.code, "CAPABILITY_GAP");
	assert.equal(mapped.details.capability, "join");
});

test("errors: truncateUtf8 bounds bytes and preserves valid UTF-8", () => {
	const { text, truncated } = truncateUtf8("aéΩ", 3);
	assert.ok(text.length <= 3);
	assert.equal(truncated, true);
	const exact = truncateUtf8("abc", 3);
	assert.equal(exact.text, "abc");
	assert.equal(exact.truncated, false);
});

test("path-policy: rejects escape and NUL, resolves within cwd", () => {
	assert.equal(
		validateWorkspacePath("/tmp/ws", "sub/file.txt"),
		"/tmp/ws/sub/file.txt",
	);
	assert.throws(
		() => validateWorkspacePath("/tmp/ws", "../escape"),
		PathPolicyError,
	);
	assert.throws(
		() => validateWorkspacePath("/tmp/ws", "a\0b"),
		PathPolicyError,
	);
});

test("path-policy: git paths reject option-like and traversal", () => {
	assert.doesNotThrow(() => assertSafeRelativeGitPath("src/a.ts"));
	assert.throws(() => assertSafeRelativeGitPath("-rf"), PathPolicyError);
	assert.throws(() => assertSafeRelativeGitPath("../escape"), PathPolicyError);
	assert.throws(() => assertSafeRelativeGitPath("sub/-x.ts"), PathPolicyError);
});

test("pi-guard: unconditionally blocks bash with the fixed reason", () => {
	const { pi, handlers } = createMockPi();
	registerBashBlocker(pi);
	const call = handlers.get("tool_call");
	assert.ok(call && call.length === 1);
	const result = call[0]?.({
		type: "tool_call",
		toolCallId: "1",
		toolName: "bash",
		input: {},
	});
	assert.deepEqual(result, { block: true, reason: BASH_BLOCK_REASON });
	const other = call[0]?.({
		type: "tool_call",
		toolCallId: "2",
		toolName: "read",
		input: {},
	});
	assert.equal(other, undefined);
});

test("status: buildStatusReport includes all five AC10 items", () => {
	const report = buildStatusReport({
		packageName: PACKAGE_NAME,
		packageVersion: PACKAGE_VERSION,
		targetPi: TARGET_PI,
		activeTools: ["read", "grep", "json_query"],
		allToolNames: [
			"read",
			"grep",
			"bash",
			"json_query",
			"query_jsonl",
			"git_status",
		],
		replacementToolNames: REPLACEMENT_TOOL_NAMES,
	});
	assert.match(report, new RegExp(PACKAGE_NAME));
	assert.match(report, new RegExp(PACKAGE_VERSION));
	assert.match(report, /active tools:/);
	assert.match(report, /json_query/);
	assert.match(report, /known general execution:/);
	assert.match(report, /bash\s+absent/);
	assert.match(report, /pi-nobash tools:/);
	assert.match(report, /json_query\s+active/);
	assert.match(report, /git_status\s+inactive/);
	assert.match(report, /configuration:\s+none known/);
});

test("status: flags NONCONFORMING when a general runner is active", () => {
	const report = buildStatusReport({
		packageName: PACKAGE_NAME,
		packageVersion: PACKAGE_VERSION,
		targetPi: TARGET_PI,
		activeTools: ["bash"],
		allToolNames: ["bash"],
		replacementToolNames: REPLACEMENT_TOOL_NAMES,
	});
	assert.match(report, /NONCONFORMING/);
	assert.match(report, /bash\s+PRESENT/);
	assert.match(
		report,
		/configuration: known general-execution tool active: bash/,
	);
});

test("status: command registers /nobash-status and renders via notify", () => {
	const { pi, commands } = createMockPi();
	registerStatusCommand(pi);
	const command = commands.find((c) => c.name === STATUS_COMMAND_NAME);
	assert.ok(command);
	assert.ok(command.description);
	const notifications: string[] = [];
	const ctx = {
		ui: { notify: (msg: string) => notifications.push(msg) },
	};
	command.handler("", ctx);
	assert.equal(notifications.length, 1);
	assert.match(notifications[0] ?? "", new RegExp(PACKAGE_NAME));
});

test("extension: registers all owned replacement tools, inactive and direct", () => {
	const { pi, tools, commands, handlers } = createMockPi();
	piNoBash(pi);

	const names = tools.map((t) => t.name).sort();
	assert.deepEqual(names, [
		"git_diff",
		"git_log",
		"git_show",
		"git_status",
		"json_query",
		"query_jsonl",
		"run_validation",
	]);
	for (const tool of tools) {
		assert.equal(tool.exposure, "direct");
		assert.equal(tool.defaultActive, false);
		assert.ok(tool.description.length > 0);
		const propertyNames = collectPropertyNames(tool.parameters);
		for (const forbidden of FORBIDDEN_PARAMS) {
			assert.equal(
				propertyNames.has(forbidden),
				false,
				`${tool.name} exposes forbidden param ${forbidden}`,
			);
		}
	}
	assert.ok(commands.some((c) => c.name === STATUS_COMMAND_NAME));
	assert.ok((handlers.get("tool_call") ?? []).length >= 1);
});
