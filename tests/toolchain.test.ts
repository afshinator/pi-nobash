import assert from "node:assert/strict";
import { test } from "node:test";
import { Type } from "typebox";
import { TOOLCHAIN_MARKER } from "./fixtures/toolchain-fixture.ts";

test("toolchain: node runs TypeScript, resolves bare host imports and .ts specifiers", () => {
	const schema = Type.Object({ check: Type.String() });
	assert.equal(schema.type, "object");
	assert.equal(TOOLCHAIN_MARKER, "pi-nobash-toolchain");
});
