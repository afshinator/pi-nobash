# Tool reference

Part of [pi-nobash](https://github.com/afshinator/pi-nobash). For per-agent selection, see
the README; for validation configuration, see [Named validation](https://github.com/afshinator/pi-nobash/blob/main/docs/validation.md).

All tools return Pi's `AgentToolResult`. Successes carry model-facing text plus
`structuredContent` matching the declared `outputSchema`. Expected failures return
`isError: true`, text prefixed with the code (`"<CODE>: <message>"`), and
`details = { code, capability?, message }`. Codes: `INVALID_ARGUMENT`, `PATH_OUT_OF_SCOPE`,
`NOT_FOUND`, `PARSE_ERROR`, `LIMIT_EXCEEDED`, `TIMEOUT`, `VALIDATION_FAILED`, `GIT_FAILED`,
`CAPABILITY_GAP`. Only unexpected `INTERNAL_ERROR` is thrown.

### `json_query`

```ts
{
  path: string,                 // JSON file, resolved against the session cwd
  root?: JsonPath,              // array of {key} | {index} segments
  where?: Predicate[],          // AND-combined
  select?: { as: string, path: JsonPath }[],
  aggregate?: { as: string, fn: "count"|"sum"|"min"|"max"|"avg", path?: JsonPath }[],
  orderBy?: { field: string, direction: "asc"|"desc" }[],
  limit?: number                // 1..500
}
```

Predicates: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `exists`, `is_null`, `in`,
`contains_string`. Output: `{ matched, returned, truncated, results }`. Numeric
operators and `sum`/`min`/`max`/`avg` accept only JSON numbers — no string coercion.
Ordering applies to projected scalar aliases, not raw paths.

### `query_jsonl`

Streams a JSONL file line by line.

```ts
{
  path: string,
  malformedLine: "error" | "skip",
  where?: Predicate[],
  select?: { as, path }[],
  groupBy?: { as, path }[],
  aggregate?: { as, fn, path? }[],
  orderBy?: { field, direction }[],
  limit?: number
}
```

Output: `{ scannedLines, parsedLines, skippedMalformedLines, matchedLines, returnedRows, truncated, results }`.
Streaming caps: 2 MiB per line, 10,000 distinct groups, 500 buffered rows for sorting —
each exceeded cap is `LIMIT_EXCEEDED`, not a silent partial result.

### Git (read-only)

```ts
git_status: { paths?: string[], includeUntracked?: boolean }
git_diff:   { mode: "working"|"staged"|"commit", revision?: string, paths?: string[], contextLines?: 0..100 }
git_log:    { maxEntries?: 1..200, paths?: string[] }
git_show:   { revision: string, paths?: string[] }
```

`revision` is accepted only for `git_diff mode:"commit"` and `git_show`. Revisions are
validated against a conservative charset and then verified with
`git rev-parse --verify --quiet <rev>^{commit}` before use. Git is invoked directly with
fixed argv — no shell, no free-form flags, no model-supplied command line. Outputs are
bounded (100 KB per stream; `git_status` fails visibly rather than returning a truncated list).

### `run_validation`

```ts
{ check: string, targets?: string[] }
```

Output: `{ check, targets, exitCode, timedOut, stdout, stderr, truncated, durationMs }`.
A nonzero exit is `VALIDATION_FAILED`, not an internal error. Every check has a
developer-set timeout; cancellation aborts the child process.

### Bounds

Model-facing limits are fixed constants, not model-chosen: 64 KiB per result text,
500 structured rows (100 default), 32 MiB JSON input, 2 MiB JSONL line, 100 KB per
Git stream, 200 Git log entries (50 default), 100 context lines, 50 paths per Git
request, 50 validation targets.
