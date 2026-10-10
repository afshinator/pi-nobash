import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
	runTool,
	ToolError,
	type ToolErrorDetails,
	truncateUtf8,
} from "../errors.ts";
import { execGit } from "./exec.ts";
import { validateCommitRevision, validateModelPaths } from "./rev.ts";

/** Output bound for git-produced text, an implementation constant (spec 9.6). */
const MAX_OUTPUT_BYTES = 100_000;
const MAX_LOG_ENTRIES = 200;
const MAX_CONTEXT_LINES = 100;

export type StatusEntry = {
	path: string;
	originalPath?: string;
	index: string;
	worktree: string;
};
export type StatusDetails = {
	branch: string | null;
	head: string | null;
	detached: boolean;
	entries: StatusEntry[];
};
export type DiffMode = "working" | "staged" | "commit";
export type DiffDetails = {
	mode: DiffMode;
	revision?: string;
	paths: string[];
	contextLines: number;
	filesChanged: number;
	truncated: boolean;
	diff: string;
};
export type LogDetails = {
	entries: Array<{
		hash: string;
		shortHash: string;
		author: string;
		authorEmail: string;
		timestamp: string;
		subject: string;
	}>;
	truncated: boolean;
};
export type ShowDetails = {
	revision: string;
	hash: string;
	author: string;
	timestamp: string;
	subject: string;
	body: string;
	diff: string;
	truncated: boolean;
};

async function gitOrFailed(
	args: string[],
	cwd: string,
	what: string,
	signal?: AbortSignal,
) {
	const out = await execGit(args, cwd, signal);
	if (out.code !== 0) {
		throw new ToolError("GIT_FAILED", `${what} failed: ${out.stderr}`);
	}
	return out;
}

function parseBranch(branchInfo: string): {
	branch: string | null;
	detached: boolean;
} {
	const detached = branchInfo.startsWith("HEAD (no branch)");
	return {
		branch:
			detached || branchInfo.length === 0
				? null
				: (branchInfo.split(" ")[0] ?? null),
		detached,
	};
}

function parseStatusRecord(
	rec: string | undefined,
	originalPath: string | undefined,
): { entry: StatusEntry; consumed: boolean } | undefined {
	if (rec === undefined || rec.length < 4) return undefined;
	const index = rec[0];
	const worktree = rec[1];
	if (index === undefined || worktree === undefined) return undefined;
	const isRename =
		index === "R" || index === "C" || worktree === "R" || worktree === "C";
	if (isRename && originalPath === undefined) return undefined;
	return {
		entry: {
			path: rec.slice(3),
			...(originalPath !== undefined ? { originalPath } : {}),
			index,
			worktree,
		},
		consumed: isRename,
	};
}

function parseStatusEntries(records: string[]): StatusEntry[] {
	const entries: StatusEntry[] = [];
	for (let i = 1; i < records.length; i += 1) {
		const parsed = parseStatusRecord(records[i], records[i + 1]);
		if (parsed === undefined) continue;
		entries.push(parsed.entry);
		if (parsed.consumed) i += 1;
	}
	return entries;
}

async function statusImpl(
	params: { paths?: string[]; includeUntracked?: boolean },
	signal: AbortSignal | undefined,
	cwd: string,
): Promise<ToolBody<StatusDetails>> {
	const paths = validateModelPaths(params.paths, cwd);
	const args = ["status", "--porcelain", "-z", "--branch"];
	if (params.includeUntracked === false) args.push("--untracked-files=no");
	args.push(...paths);
	const out = await gitOrFailed(args, cwd, "git status", signal);
	// An incomplete entry list would silently misreport the working tree; fail visibly instead.
	if (out.truncated)
		throw new ToolError(
			"LIMIT_EXCEEDED",
			"git status output exceeded the bounded buffer; narrow the request with paths",
		);

	const branchInfo = (out.stdout.split("\0")[0] ?? "").replace(/^## /, "");
	const { branch, detached } = parseBranch(branchInfo);
	const rev = await execGit(["rev-parse", "HEAD"], cwd);
	const head = rev.code === 0 ? rev.stdout.trim() : null;
	const entries = parseStatusEntries(out.stdout.split("\0"));
	const details: StatusDetails = { branch, head, detached, entries };
	const text = `branch ${branch ?? "(detached)"}: ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
	return {
		content: [{ type: "text", text }],
		details,
		structuredContent: details,
	};
}

async function diffImpl(
	params: {
		mode: DiffMode;
		revision?: string;
		paths?: string[];
		contextLines?: number;
	},
	signal?: AbortSignal,
	cwd: string = process.cwd(),
): Promise<{
	content: Array<{ type: "text"; text: string }>;
	details: DiffDetails;
	structuredContent: DiffDetails;
}> {
	const contextLines = params.contextLines ?? 3;
	if (
		!Number.isInteger(contextLines) ||
		contextLines < 0 ||
		contextLines > MAX_CONTEXT_LINES
	)
		throw new ToolError(
			"LIMIT_EXCEEDED",
			`contextLines must be an integer between 0 and ${MAX_CONTEXT_LINES}`,
		);
	if (params.mode === "commit" && !params.revision)
		throw new ToolError(
			"INVALID_ARGUMENT",
			'revision is required when mode is "commit"',
		);
	if (params.mode !== "commit" && params.revision !== undefined)
		throw new ToolError(
			"INVALID_ARGUMENT",
			'revision is only allowed when mode is "commit"',
		);
	const paths = validateModelPaths(params.paths, cwd);
	const args = ["diff", `-U${contextLines}`];
	if (params.mode === "staged") args.push("--cached");
	let revision: string | undefined;
	if (params.mode === "commit") {
		revision = await validateCommitRevision(params.revision, cwd);
		args.push(revision);
	}
	args.push(...paths);
	const out = await gitOrFailed(args, cwd, "git diff", signal);
	const { text: diff, truncated: textTruncated } = truncateUtf8(
		out.stdout,
		MAX_OUTPUT_BYTES,
	);
	const truncated = textTruncated || out.truncated;
	const filesChanged = (out.stdout.match(/^diff --git /gm) ?? []).length;
	const details: DiffDetails = {
		mode: params.mode,
		...(revision !== undefined ? { revision } : {}),
		paths,
		contextLines,
		filesChanged,
		truncated,
		diff,
	};
	const text = `${truncated ? "[truncated] " : ""}${filesChanged} file${filesChanged === 1 ? "" : "s"} changed\n${diff}`;
	return {
		content: [{ type: "text", text }],
		details,
		structuredContent: details,
	};
}

const LOG_FORMAT = "%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e";

async function logImpl(
	params: { maxEntries?: number; paths?: string[] },
	signal?: AbortSignal,
	cwd: string = process.cwd(),
): Promise<{
	content: Array<{ type: "text"; text: string }>;
	details: LogDetails;
	structuredContent: LogDetails;
}> {
	const maxEntries = params.maxEntries ?? 50;
	if (
		!Number.isInteger(maxEntries) ||
		maxEntries < 1 ||
		maxEntries > MAX_LOG_ENTRIES
	)
		throw new ToolError(
			"LIMIT_EXCEEDED",
			`maxEntries must be an integer between 1 and ${MAX_LOG_ENTRIES}`,
		);
	const paths = validateModelPaths(params.paths, cwd);
	const args = [
		"log",
		"-n",
		String(maxEntries + 1),
		`--pretty=format:${LOG_FORMAT}`,
	];
	args.push(...paths);
	const out = await gitOrFailed(args, cwd, "git log", signal);
	const records = out.stdout
		.split("\x1e")
		.map((r) => r.replace(/^\n/, ""))
		.filter((r) => r.length > 0);
	const truncated = records.length > maxEntries || out.truncated;
	const entries = records.slice(0, maxEntries).map((r) => {
		const [hash, shortHash, author, authorEmail, timestamp, subject] =
			r.split("\x1f");
		return {
			hash: hash ?? "",
			shortHash: shortHash ?? "",
			author: author ?? "",
			authorEmail: authorEmail ?? "",
			timestamp: timestamp ?? "",
			subject: subject ?? "",
		};
	});
	const details: LogDetails = { entries, truncated };
	const text = `${entries.length} commit${entries.length === 1 ? "" : "s"}${truncated ? " (more available)" : ""}`;
	return {
		content: [{ type: "text", text }],
		details,
		structuredContent: details,
	};
}

async function showImpl(
	params: { revision: string; paths?: string[] },
	signal?: AbortSignal,
	cwd: string = process.cwd(),
): Promise<{
	content: Array<{ type: "text"; text: string }>;
	details: ShowDetails;
	structuredContent: ShowDetails;
}> {
	const paths = validateModelPaths(params.paths, cwd);
	await validateCommitRevision(params.revision, cwd);
	const meta = await gitOrFailed(
		["show", "-s", `--pretty=format:${LOG_FORMAT}%x1f%b`, params.revision],
		cwd,
		"git show",
		signal,
	);
	const metaParts = (meta.stdout.split("\x1e")[0] ?? "")
		.replace(/^\n/, "")
		.split("\x1f");
	const hash = metaParts[0] ?? "";
	const author = metaParts[2] ?? "";
	const timestamp = metaParts[4] ?? "";
	const subject = metaParts[5] ?? "";
	const body = metaParts[6] ?? "";
	const diffOut = await gitOrFailed(
		["show", "--format=", params.revision, ...paths],
		cwd,
		"git show",
		signal,
	);
	const { text: diff, truncated: textTruncated } = truncateUtf8(
		diffOut.stdout,
		MAX_OUTPUT_BYTES,
	);
	const details: ShowDetails = {
		revision: params.revision,
		hash,
		author,
		timestamp,
		subject,
		body,
		diff,
		truncated: textTruncated || meta.truncated || diffOut.truncated,
	};
	const text = `${subject}${details.truncated ? "\n[truncated]" : ""}\n${diff}`;
	return {
		content: [{ type: "text", text }],
		details,
		structuredContent: details,
	};
}

type ToolBody<T> = AgentToolResult<T | ToolErrorDetails>;

/** Tool bodies wrapped in the C3 envelope: expected errors return, internals throw. */
export function gitStatus(
	params: { paths?: string[]; includeUntracked?: boolean },
	signal?: AbortSignal,
	cwd: string = process.cwd(),
): Promise<ToolBody<StatusDetails>> {
	return runTool(() => statusImpl(params, signal, cwd));
}
export function gitDiff(
	params: {
		mode: DiffMode;
		revision?: string;
		paths?: string[];
		contextLines?: number;
	},
	signal?: AbortSignal,
	cwd: string = process.cwd(),
): Promise<ToolBody<DiffDetails>> {
	return runTool(() => diffImpl(params, signal, cwd));
}
export function gitLog(
	params: { maxEntries?: number; paths?: string[] },
	signal?: AbortSignal,
	cwd: string = process.cwd(),
): Promise<ToolBody<LogDetails>> {
	return runTool(() => logImpl(params, signal, cwd));
}
export function gitShow(
	params: { revision: string; paths?: string[] },
	signal?: AbortSignal,
	cwd: string = process.cwd(),
): Promise<ToolBody<ShowDetails>> {
	return runTool(() => showImpl(params, signal, cwd));
}
