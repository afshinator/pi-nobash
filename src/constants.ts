/** Shared constants. No model-facing configuration lives here (spec §8). */

export const PACKAGE_NAME = "pi-nobash";
export const PACKAGE_VERSION = "2.3.0";
export const TARGET_PI = "@earendil-works/pi-coding-agent 1.1.0";

export const BASH_TOOL_NAME = "bash";

/** Version-specific known general-execution tool names (spec §17.3). */
export const KNOWN_GENERAL_EXECUTION_TOOLS = [
	"bash",
	"powershell",
	"codemode",
] as const;

/** Tool names (snake_case, spec §9.1). */
export const JSON_TOOL_NAME = "json_query";
export const JSONL_TOOL_NAME = "query_jsonl";
export const GIT_STATUS_TOOL_NAME = "git_status";
export const GIT_DIFF_TOOL_NAME = "git_diff";
export const GIT_LOG_TOOL_NAME = "git_log";
export const GIT_SHOW_TOOL_NAME = "git_show";
export const VALIDATION_TOOL_NAME = "run_validation";

/** Every packaged replacement tool, for diagnostics (spec §17.4). */
export const REPLACEMENT_TOOL_NAMES = [
	JSON_TOOL_NAME,
	JSONL_TOOL_NAME,
	GIT_STATUS_TOOL_NAME,
	GIT_DIFF_TOOL_NAME,
	GIT_LOG_TOOL_NAME,
	GIT_SHOW_TOOL_NAME,
	VALIDATION_TOOL_NAME,
] as const;

export const STATUS_COMMAND_NAME = "nobash-status";

/** Bounds from spec §9.6. */
export const MAX_RESULT_TEXT_BYTES = 64 * 1024;
export const MAX_STRUCTURED_ROWS = 500;
export const DEFAULT_STRUCTURED_ROWS = 100;
export const MAX_JSON_INPUT_BYTES = 32 * 1024 * 1024;
export const MAX_JSONL_LINE_BYTES = 2 * 1024 * 1024;
export const MAX_JSONL_ROWS = 500;
export const MAX_JSONL_GROUPS = 10_000;
export const MAX_GIT_PATHS = 100;
export const MAX_GIT_LOG_ENTRIES = 200;
export const DEFAULT_GIT_LOG_ENTRIES = 50;
export const MAX_GIT_CONTEXT_LINES = 100;
export const DEFAULT_GIT_CONTEXT_LINES = 3;

/** Bounded operator-array lengths (spec §9.2). */
export const MAX_PREDICATES = 100;
export const MAX_SELECTIONS = 100;
export const MAX_AGGREGATES = 100;
export const MAX_ORDER_BY = 100;

/** Read-only Git output bound: mirrors the per-result text bound (§9.6). */
export const MAX_GIT_DIFF_BYTES = MAX_RESULT_TEXT_BYTES;

export const GIT_EXECUTABLE = "git";
export const MAX_REVISION_LENGTH = 255;
