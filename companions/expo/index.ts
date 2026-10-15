import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runTool } from "../../src/errors.ts";
import { bindCompanionConfig } from "../config.ts";
import { expoDepAdd, expoDepAddTool } from "./dep-add.ts";

/**
 * Registers the Expo companion tool. There is no expo backend enum: the
 * invocation is frozen (`npx expo install`), but the workspace-binding
 * contract (FD5/A10) still applies — a call from an unbound or
 * misconfigured workspace must fail before any spawn.
 */
export function registerExpoTools(pi: ExtensionAPI): void {
	const getConfig = bindCompanionConfig(pi);
	pi.registerTool({
		...expoDepAddTool,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
			runTool(async () => {
				getConfig(ctx); // throws the C3 envelope code before any spawn
				return expoDepAdd(params, signal, ctx.cwd);
			}),
	});
}
