import { spawn } from "node:child_process";
import path from "node:path";
import {
	type FauxProviderHandle,
	type FauxResponseStep,
	fauxProvider,
} from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
	ModelRuntime,
	SessionManager,
	type ToolDefinition,
	type ToolInfo,
} from "@earendil-works/pi-coding-agent";

export type ExtensionFactoryEntry = {
	name: string;
	factory: (pi: ExtensionAPI) => void;
};

/**
 * A shared faux provider + resource loader: several sessions can be created
 * from it, each with its own cwd. Scripted responses queue globally on the
 * handle, so drive the sessions' prompts sequentially in queue order.
 */
export type FauxHarness = {
	faux: FauxProviderHandle;
	loader: DefaultResourceLoader;
	modelRuntime: ModelRuntime;
};

export async function createFauxHarness(options: {
	agentDir: string;
	cwd?: string;
	factories?: ExtensionFactoryEntry[];
}): Promise<FauxHarness> {
	const faux = fauxProvider();
	const modelRuntime = await ModelRuntime.create({
		modelsPath: null,
		authPath: path.join(options.agentDir, "auth.json"),
	});
	const loader = new DefaultResourceLoader({
		// Discovery base only; per-session cwds are passed at session creation.
		cwd: options.cwd ?? process.cwd(),
		agentDir: options.agentDir,
		noExtensions: true,
		extensionFactories: [
			...(options.factories ?? []),
			{
				name: "faux",
				factory: (pi) => {
					pi.registerProvider(faux.provider);
				},
			},
		],
	});
	await loader.reload();
	return { faux, loader, modelRuntime };
}

/**
 * Real-runtime session driven by a scripted faux provider: the agent loop,
 * tool pipeline, and extension registration are all real; only the model is
 * canned. The faux provider is registered through a real extension factory so
 * auth resolution matches the pi CLI path.
 */
export async function createFauxToolSession(options: {
	cwd: string;
	agentDir: string;
	tools: string[];
	factories?: ExtensionFactoryEntry[];
	customTools?: ToolDefinition[];
	responses?: FauxResponseStep[];
	harness?: FauxHarness;
}): Promise<{ session: AgentSession }> {
	let { harness } = options;
	if (!harness) {
		harness = await createFauxHarness({
			agentDir: options.agentDir,
			...(options.factories ? { factories: options.factories } : {}),
		});
		harness.faux.setResponses(options.responses ?? []);
	}
	const { session } = await createAgentSession({
		cwd: options.cwd,
		agentDir: options.agentDir,
		modelRuntime: harness.modelRuntime,
		model: harness.faux.getModel(),
		tools: options.tools,
		noTools: "all",
		...(options.customTools ? { customTools: options.customTools } : {}),
		resourceLoader: harness.loader,
		sessionManager: SessionManager.inMemory(options.cwd),
	});
	// SDK sessions must bind extensions explicitly for session_start to fire;
	// every real pi mode (print/TUI/RPC) does this at startup.
	await session.bindExtensions({});
	return { session };
}

/** Result of spawning the real `pi` CLI binary as a child process. */
export type RunPiResult = {
	code: number;
	stdout: string;
	stderr: string;
};

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const PI_BIN = path.join(REPO_ROOT, "node_modules/.bin/pi");

/**
 * Spawn the real node_modules/.bin/pi binary (not createAgentSession).
 * `env` must be passed explicitly to isolate PI_CODING_AGENT_DIR etc.
 */
export function runPi(
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<RunPiResult> {
	return new Promise((resolve) => {
		const child = spawn(PI_BIN, args, {
			cwd: options.cwd ?? REPO_ROOT,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		let exitCode: number | null = null;
		let streamsOpen = 2;
		const finish = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ code: exitCode ?? 1, stdout, stderr });
		};
		const timer = setTimeout(() => {
			settled = true;
			child.kill("SIGKILL");
			resolve({ code: 124, stdout, stderr: `${stderr}\nrunPi: timed out` });
		}, options.timeoutMs ?? 60_000);
		const onStreamEnd = () => {
			streamsOpen -= 1;
			if (streamsOpen === 0 && exitCode !== null) finish();
		};
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.stdout.on("close", onStreamEnd);
		child.stderr.on("close", onStreamEnd);
		child.on("exit", (code) => {
			exitCode = code;
			if (streamsOpen === 0) finish();
			// pi leaves detached children holding the stdio pipes open, so a
			// graceful close may never come: stop draining 2s after exit.
			setTimeout(finish, 2000);
		});
	});
}

export type RegisteredCommand = {
	name: string;
	description?: string;
	handler: (args: string, ctx: unknown) => Promise<void> | void;
};

export type MockPi = {
	pi: ExtensionAPI;
	tools: ToolDefinition[];
	commands: RegisteredCommand[];
	handlers: Map<string, Array<(...args: unknown[]) => unknown>>;
	setActiveTools(names: string[]): void;
	setAllTools(tools: ToolInfo[]): void;
};

export function createMockPi(): MockPi {
	const tools: ToolDefinition[] = [];
	const commands: RegisteredCommand[] = [];
	const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
	let activeTools: string[] = [];
	let allTools: ToolInfo[] = [];

	const pi = {
		on(event: string, handler: (...args: unknown[]) => unknown) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
		registerTool(tool: ToolDefinition) {
			tools.push(tool);
		},
		registerCommand(
			name: string,
			options: {
				description?: string;
				handler: (...args: unknown[]) => unknown;
			},
		) {
			commands.push({ name, ...options } as RegisteredCommand);
		},
		getActiveTools() {
			return activeTools;
		},
		getAllTools() {
			return allTools;
		},
		getSettings() {
			return {};
		},
		setActiveTools(names: string[]) {
			activeTools = names;
		},
	} as unknown as ExtensionAPI;

	return {
		pi,
		tools,
		commands,
		handlers,
		setActiveTools: (names: string[]) => {
			activeTools = names;
		},
		setAllTools: (t: ToolInfo[]) => {
			allTools = t;
		},
	};
}
