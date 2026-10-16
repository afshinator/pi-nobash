import type { JsonValue } from "../errors.ts";
import type { JsonPath, JsonScalar } from "./types.ts";

export type PathLookup = { found: true; value: JsonValue } | { found: false };

export function getPath(node: JsonValue, path: JsonPath): PathLookup {
	let cur: JsonValue | undefined = node;
	for (const seg of path) {
		if (cur === undefined) return { found: false };
		if ("key" in seg) {
			if (typeof cur === "object" && cur !== null && !Array.isArray(cur)) {
				const obj = cur as Record<string, JsonValue>;
				if (!(seg.key in obj)) return { found: false };
				cur = obj[seg.key];
			} else {
				return { found: false };
			}
		} else if (Array.isArray(cur) && seg.index >= 0 && seg.index < cur.length) {
			cur = cur[seg.index];
		} else {
			return { found: false };
		}
	}
	return { found: true, value: cur as JsonValue };
}

export function isScalar(v: unknown): v is JsonScalar {
	return (
		typeof v === "string" ||
		typeof v === "number" ||
		typeof v === "boolean" ||
		v === null
	);
}
