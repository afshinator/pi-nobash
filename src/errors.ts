import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

/** JSON-compatible value, shared by JSON/JSONL/Git structured outputs. */
export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

export type ErrorCode =
	| "INVALID_ARGUMENT"
	| "PATH_OUT_OF_SCOPE"
	| "NOT_FOUND"
	| "PARSE_ERROR"
	| "LIMIT_EXCEEDED"
	| "TIMEOUT"
	| "VALIDATION_FAILED"
	| "GIT_FAILED"
	| "CAPABILITY_GAP"
	| "INTERNAL_ERROR";

export type ToolErrorDetails = {
	code: ErrorCode;
	capability?: string;
	message: string;
};

/** Expected tool failure; mapped to the C3 envelope, never thrown to the model. */
export class ToolError extends Error {
	readonly code: ErrorCode;
	readonly capability: string | undefined;

	constructor(code: ErrorCode, message: string, capability?: string) {
		super(message);
		this.name = "ToolError";
		this.code = code;
		this.capability = capability;
	}
}

/** Reserved for unexpected failures; the only error class a tool may throw. */
export class InternalError extends Error {
	readonly code = "INTERNAL_ERROR" as const;

	constructor(message: string) {
		super(message);
		this.name = "InternalError";
	}
}

/** C3 envelope: isError, "<CODE>: <message>" text prefix, details { code, capability?, message }. */
export function errorResult(
	code: ErrorCode,
	message: string,
	capability?: string,
): AgentToolResult<ToolErrorDetails> {
	return {
		content: [{ type: "text", text: `${code}: ${message}` }],
		details: {
			code,
			...(capability !== undefined ? { capability } : {}),
			message,
		},
		isError: true,
	};
}

/** Successful result with model-facing text plus optional structured content. */
export function successResult<T>(
	content: string,
	details: T,
	structuredContent?: unknown,
): AgentToolResult<T> {
	return {
		content: [{ type: "text", text: content }],
		details,
		...(structuredContent !== undefined
			? { structuredContent: structuredContent as JsonValue }
			: {}),
	};
}

/** Converts a caught error to the C3 envelope; rethrows INTERNAL_ERROR. */
export function toToolErrorResult(
	err: unknown,
): AgentToolResult<ToolErrorDetails> {
	if (err instanceof InternalError) throw err;
	if (err instanceof ToolError)
		return errorResult(err.code, err.message, err.capability);
	if (err instanceof Error) throw new InternalError(err.message);
	throw new InternalError(String(err));
}

/** Runs a tool body, converting expected errors to the envelope and rethrowing internals. */
export async function runTool<T>(
	fn: () => Promise<AgentToolResult<T>>,
): Promise<AgentToolResult<T | ToolErrorDetails>> {
	try {
		return await fn();
	} catch (err) {
		return toToolErrorResult(err);
	}
}

/** Bounds text to `maxBytes` UTF-8 bytes without splitting surrogate pairs. */
export function truncateUtf8(
	text: string,
	maxBytes: number,
): { text: string; truncated: boolean } {
	if (Buffer.byteLength(text, "utf8") <= maxBytes)
		return { text, truncated: false };
	let out = "";
	let bytes = 0;
	for (const ch of text) {
		const b = Buffer.byteLength(ch, "utf8");
		if (bytes + b > maxBytes) break;
		out += ch;
		bytes += b;
	}
	return { text: out, truncated: true };
}

/** Appends a truncation notice to model-facing text when the source was truncated. */
export function withTruncationNotice(text: string, truncated: boolean): string {
	if (!truncated) return text;
	return `${text}\n[truncated]`;
}
