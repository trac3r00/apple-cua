import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { readConnection, writeConnection } from "./connection.js";
import {
	DEFAULT_PORT,
	EXTENSION_ID,
	NATIVE_HOST_NAME,
	SERVICE_LABEL,
	initializeConnectionMetadata,
	installBrowserService,
	renderLaunchAgent,
	renderNativeHostLauncher,
	renderNativeHostManifest,
} from "./service.js";

const nativeManifestSchema = z
	.object({
		name: z.string(),
		description: z.string(),
		path: z.string(),
		type: z.literal("stdio"),
		allowed_origins: z.array(z.string()),
	})
	.strict();

describe("browser service artifacts", () => {
	const directories: string[] = [];

	afterEach(async () => {
		await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
	});

	it("#given an empty state directory #when initializing service metadata #then persists a private reusable key", async () => {
		const stateDirectory = await mkdtemp(join(tmpdir(), "browser-service-"));
		directories.push(stateDirectory);

		const first = await initializeConnectionMetadata(stateDirectory);
		const second = await initializeConnectionMetadata(stateDirectory);

		expect(first.port).toBe(DEFAULT_PORT);
		expect(first.token).toMatch(/^[0-9a-f]{64}$/);
		expect(second).toEqual(first);
		expect(await readConnection(stateDirectory)).toEqual(first);
		expect((await stat(join(stateDirectory, "browser-connection.json"))).mode & 0o777).toBe(0o600);
	});

	it("#given absolute runtime paths #when rendering LaunchAgent #then configures persistent direct Node startup", () => {
		const paths = {
			launchAgent: "/tmp/home/Library/LaunchAgents/service.plist",
			nativeHostManifest: "/tmp/home/Library/Application Support/Brave/host.json",
			nativeHostProgram: "/tmp/package/dist/native-host.js",
			nativeHostLauncher: "/tmp/home/state/browser-native-host",
			stateDirectory: "/tmp/home/state",
			cliProgram: "/tmp/package/dist/cli.js",
			logDirectory: "/tmp/home/Library/Logs/Browser-Skill-OmO",
			stdoutLog: "/tmp/home/Library/Logs/Browser-Skill-OmO/stdout.log",
			stderrLog: "/tmp/home/Library/Logs/Browser-Skill-OmO/stderr.log",
		};
		const plist = renderLaunchAgent(paths, "/opt/node/bin/node");

		expect(plist).toContain(`<string>${SERVICE_LABEL}</string>`);
		expect(plist).toContain("<string>/opt/node/bin/node</string>");
		expect(plist).toContain("<string>/tmp/package/dist/cli.js</string>");
		expect(plist).toContain("<string>serve</string>");
		expect(plist).toContain("<key>RunAtLoad</key>\n\t<true/>");
		expect(plist).toContain("<key>KeepAlive</key>\n\t<true/>");
		expect(plist).toContain(paths.stdoutLog);
		expect(plist).toContain(paths.stderrLog);
	});

	it("#given an unused browser port #when installing #then registers native messaging before bootstrapping the agent", async () => {
		const homeDirectory = await mkdtemp(join(tmpdir(), "browser-service-install-"));
		directories.push(homeDirectory);
		const packageRoot = join(homeDirectory, "package");
		const stateDirectory = join(homeDirectory, "state");
		const manifestPath = join(
			homeDirectory,
			"Library",
			"Application Support",
			"BraveSoftware",
			"Brave-Browser",
			"NativeMessagingHosts",
			`${NATIVE_HOST_NAME}.json`,
		);
		const calls: string[][] = [];
		const launchctl = async (arguments_: readonly string[]) => {
			calls.push([...arguments_]);
			if (arguments_[0] === "bootstrap") {
				const registration = await readFile(manifestPath, "utf8");
				expect(registration).toContain(`chrome-extension://${EXTENSION_ID}/`);
				return { code: 0, stderr: "" };
			}
			return { code: 113, stderr: "" };
		};

		const paths = await installBrowserService({
			homeDirectory,
			packageRoot,
			nodePath: "/opt/node/bin/node",
			platform: "darwin",
			uid: 501,
			stateDirectory,
			isPortListening: async () => false,
			launchctl,
		});

		expect(calls).toEqual([
			["print", `gui/501/${SERVICE_LABEL}`],
			["bootstrap", "gui/501", paths.launchAgent],
		]);
		expect((await stat(paths.stdoutLog)).mode & 0o777).toBe(0o600);
		expect((await stat(paths.stderrLog)).mode & 0o777).toBe(0o600);
		expect((await stat(paths.logDirectory)).mode & 0o777).toBe(0o700);
		expect((await stat(paths.nativeHostLauncher)).mode & 0o777).toBe(0o700);
		expect(await readConnection(stateDirectory)).toMatchObject({ port: DEFAULT_PORT });
	});

	it("#given a port owned by an existing stdio daemon #when installing #then refuses to bootstrap a duplicate", async () => {
		const homeDirectory = await mkdtemp(join(tmpdir(), "browser-service-conflict-"));
		directories.push(homeDirectory);
		const calls: string[][] = [];
		const launchctl = async (arguments_: readonly string[]) => {
			calls.push([...arguments_]);
			return { code: 113, stderr: "" };
		};

		await expect(
			installBrowserService({
				homeDirectory,
				packageRoot: join(homeDirectory, "package"),
				platform: "darwin",
				uid: 501,
				stateDirectory: join(homeDirectory, "state"),
				isPortListening: async () => true,
				launchctl,
			}),
		).rejects.toThrow();

		expect(calls).toEqual([["print", `gui/501/${SERVICE_LABEL}`]]);
	});

	it("#given the Brave extension registration #when rendering the native host manifest #then restricts it to the expected extension", () => {
		const paths = {
			launchAgent: "/tmp/home/agent.plist",
			nativeHostManifest: "/tmp/home/host.json",
			nativeHostProgram: "/tmp/package/dist/native-host.js",
			nativeHostLauncher: "/tmp/home/state/browser-native-host",
			stateDirectory: "/tmp/home/state",
			cliProgram: "/tmp/package/dist/cli.js",
			logDirectory: "/tmp/home/logs",
			stdoutLog: "/tmp/home/logs/stdout.log",
			stderrLog: "/tmp/home/logs/stderr.log",
		};
		const manifest = nativeManifestSchema.parse(JSON.parse(renderNativeHostManifest(paths)));

		expect(manifest.name).toBe(NATIVE_HOST_NAME);
		expect(manifest.description.length).toBeGreaterThan(0);
		expect(manifest.path).toBe(paths.nativeHostLauncher);
		expect(manifest.type).toBe("stdio");
		expect(manifest.allowed_origins).toEqual([`chrome-extension://${EXTENSION_ID}/`]);
	});

	it("#given existing custom connection metadata #when initializing #then preserves port and key", async () => {
		const stateDirectory = await mkdtemp(join(tmpdir(), "browser-service-existing-"));
		directories.push(stateDirectory);
		const connection = { port: 48999, token: "a".repeat(64) };
		await writeConnection(connection, stateDirectory);
		expect(await initializeConnectionMetadata(stateDirectory)).toEqual(connection);
	});

	it.each([EXTENSION_ID, "p".repeat(32)])(
		"#given a native launcher for %s with spaced paths #when Chrome supplies origin #then forwards origin and private state",
		async (extensionId) => {
			const homeDirectory = await mkdtemp(join(tmpdir(), "browser host's state-"));
			directories.push(homeDirectory);
			const hostProgram = join(homeDirectory, "native host.js");
			const paths = {
				launchAgent: join(homeDirectory, "agent.plist"),
				nativeHostManifest: join(homeDirectory, "manifest.json"),
				nativeHostProgram: hostProgram,
				nativeHostLauncher: join(homeDirectory, "launcher"),
				stateDirectory: join(homeDirectory, "state"),
				cliProgram: join(homeDirectory, "cli.js"),
				logDirectory: homeDirectory,
				stdoutLog: join(homeDirectory, "stdout"),
				stderrLog: join(homeDirectory, "stderr"),
			};
			await mkdir(paths.stateDirectory);
			await writeFile(
				hostProgram,
				"process.stdout.write(JSON.stringify({origin:process.argv[2],state:process.env.APPLE_CUA_STATE_DIR,extensionId:process.env.APPLE_CUA_BROWSER_EXTENSION_ID}));",
			);
			await writeFile(paths.nativeHostLauncher, renderNativeHostLauncher(paths, process.execPath, extensionId));
			await chmod(paths.nativeHostLauncher, 0o700);
			const origin = `chrome-extension://${extensionId}/`;
			const result = await promisify(execFile)(paths.nativeHostLauncher, [origin], { timeout: 3000 });
			const parsed = z
				.object({ origin: z.string(), state: z.string(), extensionId: z.string() })
				.parse(JSON.parse(result.stdout));
			expect(parsed).toEqual({ origin, state: paths.stateDirectory, extensionId });
			const manifest = nativeManifestSchema.parse(JSON.parse(renderNativeHostManifest(paths, extensionId)));
			expect(manifest.allowed_origins).toEqual([origin]);
		},
	);
});
