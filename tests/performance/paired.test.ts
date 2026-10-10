import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import type { ToolErrorDetails } from "../../src/errors.ts";
import {
	type JsonlQueryDetails,
	runQueryJsonl,
} from "../../src/json/jsonl-query.ts";

const execFileP = promisify(execFile);

const LINE_COUNT = 50_000;
const SEED = 0x5eed1234;
const TASK =
	"filter status==error; groupBy [service,region]; count; orderBy count desc; limit 10";

type Row = { service: string; region: string; count: number };

type ArmMetrics = {
	duration_ms: number;
	input_bytes: number;
	output_bytes: number;
	rows_scanned: number;
	rows_returned: number;
	truncated: boolean;
};

type PairedRow = {
	task: string;
	task_result: "PASS" | "CAPABILITY_GAP" | "incorrect" | "error";
	measured_note: string;
	legacy_bash_arm: ArmMetrics & { runner: string };
	pi_nobash_arm: ArmMetrics & { runner: string };
};

/** Arm A: the legacy Bash-enabled equivalent as a fixed local script (dev fixture only). */
const LEGACY_PROGRAM = `
const rl = require("node:readline").createInterface({ input: require("node:fs").createReadStream(process.env.FIXTURE), crlfDelay: Infinity });
const groups = new Map();
let scanned = 0;
rl.on("line", (line) => {
	scanned += 1;
	const r = JSON.parse(line);
	if (r.status !== "error") return;
	const k = r.service + "\\u0000" + r.region;
	const g = groups.get(k);
	if (g) g.count += 1; else groups.set(k, { service: r.service, region: r.region, count: 1 });
});
rl.on("close", () => {
	const rows = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 10);
	process.stdout.write(JSON.stringify({ results: rows, rows_scanned: scanned, groups: groups.size }));
});
`;

function makeFixture(dir: string): string {
	const services = ["api", "worker", "edge", "billing", "auth"];
	const regions = ["us", "eu", "apac", "sa"];
	const statuses = ["ok", "ok", "ok", "error", "warn"];
	let s = SEED >>> 0;
	// Use high bits: LCG low bits are correlated, which would collapse field variety.
	const next = (mod: number) => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return (s >>> 8) % mod;
	};
	const lines: string[] = [];
	for (let i = 0; i < LINE_COUNT; i += 1) {
		const record = {
			id: i,
			ts: 1700000000000 + i * 1000,
			service: services[next(services.length)],
			region: regions[next(regions.length)],
			status: statuses[next(statuses.length)],
			latency_ms: next(5000),
		};
		lines.push(JSON.stringify(record));
	}
	const file = path.join(dir, "workload.jsonl");
	writeFileSync(file, `${lines.join("\n")}\n`);
	return file;
}

let fixtureDir: string;
let fixturePath: string;

after(() => {
	rmSync(fixtureDir, { recursive: true, force: true });
});

function baseMetrics(bytes: number): Omit<ArmMetrics, "duration_ms"> {
	return {
		input_bytes: bytes,
		output_bytes: 0,
		rows_scanned: 0,
		rows_returned: 0,
		truncated: false,
	};
}

before(() => {
	fixtureDir = mkdtempSync(path.join(tmpdir(), "pi-nobash-perf-"));
	fixturePath = makeFixture(fixtureDir);
});

test("paired performance: query_jsonl vs fixed legacy script on one deterministic task", {
	timeout: 120_000,
}, async () => {
	const inputBytes = statSync(fixturePath).size;

	// Arm A first: fixed script via execFile.
	const aStart = performance.now();
	const a = await execFileP("node", ["-e", LEGACY_PROGRAM], {
		env: { ...process.env, FIXTURE: fixturePath },
		maxBuffer: 1024 * 1024,
	});
	const aDuration = performance.now() - aStart;
	const aParsed = JSON.parse(a.stdout) as {
		results: Row[];
		rows_scanned: number;
		groups: number;
	};

	// Arm B: the real registered query_jsonl tool body on the same file.
	const bStart = performance.now();
	const b = await runQueryJsonl(
		{
			path: "workload.jsonl",
			malformedLine: "error",
			where: [{ path: [{ key: "status" }], op: "eq", value: "error" }],
			groupBy: [
				{ as: "service", path: [{ key: "service" }] },
				{ as: "region", path: [{ key: "region" }] },
			],
			aggregate: [{ as: "count", fn: "count" }],
			orderBy: [{ field: "count", direction: "desc" }],
			limit: 10,
		},
		fixtureDir,
	);
	const bDuration = performance.now() - bStart;
	const bDetails = b.details as ToolErrorDetails | JsonlQueryDetails;
	if ("code" in bDetails)
		throw new Error(`query_jsonl failed: ${bDetails.message}`);
	const okDetails = bDetails as JsonlQueryDetails;

	// Correctness before speed: identical aggregate results.
	assert.deepEqual(okDetails.results, aParsed.results);

	const armA: { arm: string } & ArmMetrics & Record<string, unknown> = {
		arm: "legacy_bash_script",
		duration_ms: Number(aDuration.toFixed(1)),
		...baseMetrics(inputBytes),
		output_bytes: Buffer.byteLength(JSON.stringify(aParsed.results), "utf8"),
		rows_scanned: aParsed.rows_scanned,
		rows_returned: aParsed.results.length,
		truncated: aParsed.groups > 10,
	};
	const armB: { arm: string } & ArmMetrics & Record<string, unknown> = {
		arm: "pi_nobash_query_jsonl",
		duration_ms: Number(bDuration.toFixed(1)),
		...baseMetrics(inputBytes),
		output_bytes: Buffer.byteLength(JSON.stringify(okDetails.results), "utf8"),
		rows_scanned: okDetails.scannedLines,
		rows_returned: okDetails.returnedRows,
		truncated: okDetails.truncated,
	};

	const paired: PairedRow = {
		task: TASK,
		task_result: "PASS",
		measured_note:
			"model_turns and token counts were NOT measured (no model invocation headless); single paired run on a 50k-line seeded fixture; no speedup percentage claimed; historical 411-vs-414 discrepancy unreconciled",
		legacy_bash_arm: { runner: "node -e fixed program via execFile", ...armA },
		pi_nobash_arm: {
			runner: "runQueryJsonl (registered query_jsonl body)",
			...armB,
		},
	};
	writeFileSync(
		path.join(process.cwd(), "tests", "performance", "paired-results.json"),
		`${JSON.stringify(paired, null, "\t")}\n`,
	);

	assert.equal(aParsed.results.length, 10);
	assert.equal(okDetails.returnedRows, 10);
	assert.equal(okDetails.truncated, aParsed.groups > 10);
	assert.equal(aParsed.rows_scanned, 50_000);
});
