import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { executeCopy } from "../../companions/files/copy.ts";
import { registerFileTools } from "../../companions/files/index.ts";
import { executeMove } from "../../companions/files/move.ts";
import { recordSpawns } from "../helpers/companion-harness.ts";

const dirs: string[] = [];
function workspace(): string {
	const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "pi-nobash-fs-")));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const file = (ws: string, rel: string, content: string) => {
	mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
	writeFileSync(path.join(ws, rel), content);
};
const bytes = (ws: string, rel: string) =>
	readFileSync(path.join(ws, rel)).toString();

/** Error code from the returned envelope (expected failures never throw). */
async function errCode(fn: () => Promise<unknown>): Promise<{
	code: string;
	capability: string | undefined;
}> {
	const r = (await fn()) as {
		details?: { code?: string; capability?: string };
	};
	return {
		code: r.details?.code ?? "OK",
		capability: r.details?.capability,
	};
}

test("registration: registerFileTools exposes only fs_copy/fs_move, defaultActive false", () => {
	const tools: { name: string; defaultActive?: boolean }[] = [];
	const pi = {
		registerTool: (t: { name: string; defaultActive?: boolean }) =>
			tools.push(t),
		registerCommand: () => {},
		on: () => {},
	} as unknown as ExtensionAPI;
	registerFileTools(pi);
	assert.deepEqual(tools.map((t) => t.name).sort(), ["fs_copy", "fs_move"]);
	for (const t of tools) assert.equal(t.defaultActive, false);
});

test("fs_copy: copies one regular file byte-for-byte; source and unrelated files untouched", async () => {
	const ws = workspace();
	file(ws, "src/a.txt", "alpha-bytes\n");
	mkdirSync(path.join(ws, "dst"));
	file(ws, "other.txt", "untouched\n");
	const recorder = recordSpawns();
	try {
		const r = (await executeCopy(
			{ from: "src/a.txt", to: "dst/b.txt" },
			ws,
		)) as {
			details: { from: string; to: string };
		};
		assert.deepEqual(r.details, { from: "src/a.txt", to: "dst/b.txt" });
		assert.equal(bytes(ws, "dst/b.txt"), "alpha-bytes\n");
		assert.equal(bytes(ws, "src/a.txt"), "alpha-bytes\n");
		assert.equal(bytes(ws, "other.txt"), "untouched\n");
		assert.equal(recorder.spawns.length, 0);
	} finally {
		recorder.restore();
	}
});

test("fs_copy: directory source is CAPABILITY_GAP 'recursive copy', nothing written", async () => {
	const ws = workspace();
	file(ws, "dir/inner.txt", "x\n");
	const recorder = recordSpawns();
	try {
		const e = await errCode(() => executeCopy({ from: "dir", to: "copy" }, ws));
		assert.equal(e.code, "CAPABILITY_GAP");
		assert.equal(e.capability, "recursive copy");
		assert.ok(!existsSync(path.join(ws, "copy")));
		assert.equal(recorder.spawns.length, 0);
	} finally {
		recorder.restore();
	}
});

test("fs_copy: existing destination is CAPABILITY_GAP 'overwrite mode', dest bytes unchanged", async () => {
	const ws = workspace();
	file(ws, "src.txt", "new\n");
	file(ws, "dst.txt", "original-bytes\n");
	const recorder = recordSpawns();
	try {
		const e = await errCode(() =>
			executeCopy({ from: "src.txt", to: "dst.txt" }, ws),
		);
		assert.equal(e.code, "CAPABILITY_GAP");
		assert.equal(e.capability, "overwrite mode");
		assert.equal(bytes(ws, "dst.txt"), "original-bytes\n");
		assert.equal(recorder.spawns.length, 0);
	} finally {
		recorder.restore();
	}
});

test("fs_copy: missing source is NOT_FOUND", async () => {
	const ws = workspace();
	const e = await errCode(() => executeCopy({ from: "nope.txt", to: "b" }, ws));
	assert.equal(e.code, "NOT_FOUND");
});

test("fs_copy: NUL, traversal, absolute, and symlink escapes rejected before any write", async () => {
	const ws = workspace();
	const outside = mkdtempSync(path.join(tmpdir(), "pi-nobash-outside-"));
	try {
		symlinkSync(outside, path.join(ws, "escape"));
		for (const [from, to] of [
			["a\0b", "b"],
			["../x", "b"],
			["/etc/passwd", "b"],
			["escape/secret.txt", "b"],
			["a", "escape/secret.txt"],
			["a", "../out"],
		] as const) {
			const e = await errCode(() => executeCopy({ from, to }, ws));
			assert.ok(
				e.code === "PATH_OUT_OF_SCOPE" || e.code === "INVALID_ARGUMENT",
				`expected coded rejection for ${from} -> ${to}, got ${e.code}`,
			);
			assert.ok(!existsSync(path.join(ws, "b")));
		}
	} finally {
		rmSync(outside, { recursive: true, force: true });
	}
});

test("fs_copy: missing destination parent is NOT_FOUND; the parent is not created", async () => {
	const ws = workspace();
	file(ws, "src.txt", "x\n");
	const recorder = recordSpawns();
	try {
		const e = await errCode(() =>
			executeCopy({ from: "src.txt", to: "no-such-dir/out.txt" }, ws),
		);
		assert.equal(e.code, "NOT_FOUND");
		assert.ok(!existsSync(path.join(ws, "no-such-dir")));
		assert.equal(recorder.spawns.length, 0);
	} finally {
		recorder.restore();
	}
});

test("fs_move: renames a file, source gone, dest has the bytes, zero spawns", async () => {
	const ws = workspace();
	file(ws, "a.txt", "move-me\n");
	file(ws, "other.txt", "untouched\n");
	mkdirSync(path.join(ws, "sub"));
	const recorder = recordSpawns();
	try {
		const r = (await executeMove({ from: "a.txt", to: "sub/b.txt" }, ws)) as {
			details: { from: string; to: string };
		};
		assert.deepEqual(r.details, { from: "a.txt", to: "sub/b.txt" });
		assert.equal(bytes(ws, "sub/b.txt"), "move-me\n");
		assert.ok(!existsSync(path.join(ws, "a.txt")));
		assert.equal(bytes(ws, "other.txt"), "untouched\n");
		assert.equal(recorder.spawns.length, 0);
	} finally {
		recorder.restore();
	}
});

test("fs_move: missing destination parent is NOT_FOUND; the parent is not created", async () => {
	const ws = workspace();
	file(ws, "a.txt", "x\n");
	const e = await errCode(() =>
		executeMove({ from: "a.txt", to: "no-such-dir/b.txt" }, ws),
	);
	assert.equal(e.code, "NOT_FOUND");
	assert.ok(existsSync(path.join(ws, "a.txt")), "source must be untouched");
	assert.ok(!existsSync(path.join(ws, "no-such-dir")));
});

test("fs_move: renames a directory in place — same inode, no content copy", async () => {
	const ws = workspace();
	file(ws, "proj/inner.txt", "inside\n");
	const inoBefore = statSync(path.join(ws, "proj")).ino;
	const recorder = recordSpawns();
	try {
		await executeMove({ from: "proj", to: "renamed" }, ws);
		const st = statSync(path.join(ws, "renamed"));
		assert.ok(st.isDirectory());
		assert.equal(
			st.ino,
			inoBefore,
			"directory inode must be preserved (rename, not copy)",
		);
		assert.equal(bytes(ws, "renamed/inner.txt"), "inside\n");
		assert.ok(!existsSync(path.join(ws, "proj")));
		assert.equal(recorder.spawns.length, 0);
	} finally {
		recorder.restore();
	}
});

test("fs_move: existing destination is CAPABILITY_GAP 'overwrite mode', dest bytes unchanged", async () => {
	const ws = workspace();
	file(ws, "src.txt", "new\n");
	file(ws, "dst.txt", "original-bytes\n");
	const e = await errCode(() =>
		executeMove({ from: "src.txt", to: "dst.txt" }, ws),
	);
	assert.equal(e.code, "CAPABILITY_GAP");
	assert.equal(e.capability, "overwrite mode");
	assert.equal(bytes(ws, "dst.txt"), "original-bytes\n");
	assert.equal(bytes(ws, "src.txt"), "new\n");
});

test("fs_move: missing source is NOT_FOUND; unsupported keys are CAPABILITY_GAP", async () => {
	const ws = workspace();
	assert.equal(
		(await errCode(() => executeMove({ from: "nope", to: "b" }, ws))).code,
		"NOT_FOUND",
	);
	assert.equal(
		(
			await errCode(() =>
				executeMove({ from: "a", to: "b", recursive: true }, ws),
			)
		).code,
		"CAPABILITY_GAP",
	);
	assert.equal(
		(await errCode(() => executeMove({ from: "a*", to: "b" }, ws))).code,
		"CAPABILITY_GAP",
	);
});

test("fs_move: symlink escapes rejected before any rename", async () => {
	const ws = workspace();
	file(ws, "a.txt", "x\n");
	const outside = mkdtempSync(path.join(tmpdir(), "pi-nobash-outside-"));
	try {
		symlinkSync(outside, path.join(ws, "escape"));
		const e = await errCode(() =>
			executeMove({ from: "a.txt", to: "escape/b.txt" }, ws),
		);
		assert.equal(e.code, "PATH_OUT_OF_SCOPE");
		assert.ok(existsSync(path.join(ws, "a.txt")), "source must be untouched");
	} finally {
		rmSync(outside, { recursive: true, force: true });
	}
});
