import { type JsonValue, ToolError } from "../errors.ts";
import { getPath, isScalar } from "./paths.ts";
import type { Predicate } from "./types.ts";

export function evaluatePredicate(record: JsonValue, pred: Predicate): boolean {
	const lookup = getPath(record, pred.path);
	switch (pred.op) {
		case "exists":
			return lookup.found;
		case "is_null":
			return lookup.found && lookup.value === null;
		case "eq":
			return lookup.found && lookup.value === pred.value;
		case "ne":
			return !(lookup.found && lookup.value === pred.value);
		case "lt":
		case "lte":
		case "gt":
		case "gte": {
			if (!lookup.found) return false;
			const a = lookup.value;
			const b = pred.value;
			if (typeof a === "number" && typeof b === "number") {
				switch (pred.op) {
					case "lt":
						return a < b;
					case "lte":
						return a <= b;
					case "gt":
						return a > b;
					default:
						return a >= b;
				}
			}
			if (typeof a === "string" && typeof b === "string") {
				switch (pred.op) {
					case "lt":
						return a < b;
					case "lte":
						return a <= b;
					case "gt":
						return a > b;
					default:
						return a >= b;
				}
			}
			return false;
		}
		case "in": {
			if (!lookup.found || !isScalar(lookup.value)) return false;
			return Array.isArray(pred.value) && pred.value.includes(lookup.value);
		}
		case "contains_string": {
			if (!lookup.found || typeof lookup.value !== "string") return false;
			return lookup.value.includes(pred.value as string);
		}
	}
}

/** Shared numeric policy §9.5: reject non-finite and unsafe-integer JSON numbers. */
export function assertSafeNumbers(value: JsonValue): void {
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new ToolError(
				"LIMIT_EXCEEDED",
				"non-finite number is not supported",
			);
		}
		if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
			throw new ToolError(
				"LIMIT_EXCEEDED",
				"integer outside the safe range is not supported",
			);
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const v of value) assertSafeNumbers(v);
		return;
	}
	if (typeof value === "object" && value !== null) {
		for (const v of Object.values(value)) assertSafeNumbers(v as JsonValue);
	}
}

export function validatePredicates(predicates: Predicate[]): void {
	for (const p of predicates) {
		switch (p.op) {
			case "exists":
			case "is_null":
				if (p.value !== undefined) {
					throw new ToolError(
						"INVALID_ARGUMENT",
						`predicate "${p.op}" must not carry a value`,
					);
				}
				break;
			case "in":
				if (!Array.isArray(p.value) || !p.value.every(isScalar)) {
					throw new ToolError(
						"INVALID_ARGUMENT",
						'predicate "in" requires an array of scalar values',
					);
				}
				break;
			case "contains_string":
				if (typeof p.value !== "string") {
					throw new ToolError(
						"INVALID_ARGUMENT",
						'predicate "contains_string" requires a string value',
					);
				}
				break;
			default:
				if (!isScalar(p.value)) {
					throw new ToolError(
						"INVALID_ARGUMENT",
						`predicate "${p.op}" requires a scalar value`,
					);
				}
		}
	}
}

export function matchesAll(
	record: JsonValue,
	predicates: Predicate[],
): boolean {
	for (const p of predicates) {
		if (!evaluatePredicate(record, p)) return false;
	}
	return true;
}
