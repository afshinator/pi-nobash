import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { registerGitTools } from "../../src/git/index.ts";
import { registerJsonTools } from "../../src/json/index.ts";
import { registerValidationTools } from "../../src/validation/index.ts";

const READ_ONLY_TOOLS = new Set([
	"json_query",
	"query_jsonl",
	"git_status",
	"git_diff",
	"git_log",
	"git_show",
]);

type AnyTool = {
	name: string;
	promptSnippet?: string;
	annotations?: { readOnlyHint?: boolean };
};

interface FakePi {
	registerTool(tool: AnyTool): void;
	on(event: string, handler: unknown): void;
}

function collectRegisteredTools(): AnyTool[] {
	const tools: AnyTool[] = [];
	const pi: FakePi = {
		registerTool: (tool) => tools.push(tool),
		on: () => {},
	};
	registerJsonTools(pi as never);
	registerGitTools(pi as never);
	registerValidationTools(pi as never, "/tmp");
	return tools;
}

test("A11: every packaged tool has a non-empty one-line promptSnippet", () => {
	const tools = collectRegisteredTools();
	const names = tools.map((t) => t.name).sort();
	assert.deepEqual(names, [...READ_ONLY_TOOLS, "run_validation"].sort());
	for (const tool of tools) {
		assert.ok(
			typeof tool.promptSnippet === "string" && tool.promptSnippet.length > 0,
			`tool ${tool.name} is missing promptSnippet`,
		);
		assert.ok(
			!tool.promptSnippet.includes("\n"),
			`tool ${tool.name} promptSnippet must be one line`,
		);
	}
});

test("A11: readOnlyHint true on the six read-only tools, absent on run_validation", () => {
	for (const tool of collectRegisteredTools()) {
		const hint = tool.annotations?.readOnlyHint === true;
		if (READ_ONLY_TOOLS.has(tool.name)) {
			assert.ok(hint, `${tool.name} must declare readOnlyHint: true`);
		} else {
			assert.ok(
				tool.annotations?.readOnlyHint !== true,
				"run_validation must not declare readOnlyHint",
			);
		}
	}
});

test("A11: every bare import in src/, extensions/, tests/ is declared in package.json", () => {
	const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
		dependencies?: Record<string, string>;
		peerDependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
	const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
		packages: Record<
			string,
			{
				dependencies?: Record<string, string>;
				peerDependencies?: Record<string, string>;
				devDependencies?: Record<string, string>;
			}
		>;
	};
	const lockRoot = lock.packages[""] ?? {};
	const lockDeclared = new Set(
		Object.keys({
			...lockRoot.dependencies,
			...lockRoot.peerDependencies,
			...lockRoot.devDependencies,
		}),
	);
	const declared = new Set(
		Object.keys({
			...pkg.dependencies,
			...pkg.peerDependencies,
			...pkg.devDependencies,
		}),
	);
	// F2 lockfile consistency: a name declared in package.json must also appear
	// in the lockfile's root entry, or a clean install is not reproducible.
	for (const name of declared) {
		assert.ok(
			lockDeclared.has(name),
			`${name} is declared in package.json but missing from package-lock.json's root entry`,
		);
	}
	const RE = /(?:\bfrom\s+|\bimport\s*\(?\s*)["']([^"'\n]+)["']/g;
	const undeclared: string[] = [];
	for (const dir of ["src", "extensions", "tests"]) {
		for (const dirent of readdirSync(dir, {
			recursive: true,
			withFileTypes: true,
		})) {
			if (!dirent.isFile() || !dirent.name.endsWith(".ts")) continue;
			const file = `${dirent.parentPath}/${dirent.name}`;
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(RE)) {
				const specifier = match[1] as string;
				if (
					specifier.startsWith(".") ||
					specifier.startsWith("node:") ||
					declared.has(specifier)
				) {
					continue;
				}
				undeclared.push(`${file}: ${specifier}`);
			}
		}
	}
	assert.deepEqual(undeclared, []);
});
