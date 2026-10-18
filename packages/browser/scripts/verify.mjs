import { spawn } from "node:child_process";
import { once } from "node:events";
import { watch } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StopSwitch } from "@apple-cua/core/stop";
import WebSocket from "ws";
import { writeConnection } from "../dist/connection.js";
import { BrowserBridge, BrowserController, BrowserSession } from "../dist/index.js";
import { NATIVE_HOST_NAME, renderNativeHostLauncher, renderNativeHostManifest } from "../dist/service.js";

const timeout = (promise, ms, label) =>
	Promise.race([
		promise,
		new Promise((_, reject) => {
			const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
			promise.then(
				() => clearTimeout(timer),
				() => clearTimeout(timer),
			);
		}),
	]);

function waitForLine(streams, pattern, ms, label) {
	return timeout(
		new Promise((resolveLine, reject) => {
			let output = "";
			const listeners = [];
			const finish = (error, value) => {
				for (const [stream, event, listener] of listeners) stream.removeListener(event, listener);
				if (error) reject(error);
				else resolveLine(value);
			};
			for (const stream of streams) {
				for (const event of ["data"]) {
					const listener = (chunk) => {
						output += chunk.toString();
						const match = output.match(pattern);
						if (match) finish(undefined, match[1]);
						else if (output.length > 65536) output = output.slice(-32768);
					};
					stream.on(event, listener);
					listeners.push([stream, event, listener]);
				}
			}
			const errorListener = (error) => finish(error);
			for (const stream of streams) {
				stream.once("error", errorListener);
				listeners.push([stream, "error", errorListener]);
			}
		}),
		ms,
		label,
	);
}

function waitForDevtools(directory) {
	let timer;
	let watcher;
	const promise = new Promise((resolveReady, reject) => {
		watcher = watch(directory, (_event, filename) => {
			if (filename !== "DevToolsActivePort") return;
			void readFile(join(directory, filename), "utf8").then(
				(content) => {
					const [port, path] = content.trim().split("\n");
					if (!port || !path) return;
					clearTimeout(timer);
					watcher.close();
					resolveReady(`ws://127.0.0.1:${port}${path}`);
				},
				(error) => {
					if (error.code !== "ENOENT") reject(error);
				},
			);
		});
		timer = setTimeout(() => reject(new Error("Background browser DevTools startup timed out")), 15000);
	});
	return {
		promise,
		close() {
			clearTimeout(timer);
			watcher.close();
		},
	};
}

class Cdp {
	#socket;
	#nextId = 0;
	#pending = new Map();
	#events = new Map();

	constructor(socket) {
		this.#socket = socket;
		socket.on("message", (raw) => {
			const message = JSON.parse(raw.toString());
			if (message.id !== undefined) {
				const pending = this.#pending.get(message.id);
				if (!pending) return;
				clearTimeout(pending.timer);
				this.#pending.delete(message.id);
				if (message.error) pending.reject(new Error(message.error.message));
				else pending.resolve(message.result);
				return;
			}
			if (message.method) {
				for (const listener of this.#events.get(message.method) ?? []) listener(message.params);
			}
		});
	}

	static async connect(url) {
		const socket = new WebSocket(url);
		await timeout(once(socket, "open"), 5000, "CDP websocket open");
		return new Cdp(socket);
	}

	on(method, listener) {
		const listeners = this.#events.get(method) ?? new Set();
		listeners.add(listener);
		this.#events.set(method, listeners);
		return () => listeners.delete(listener);
	}

	call(method, params, sessionId) {
		const id = ++this.#nextId;
		return new Promise((resolveCall, rejectCall) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				rejectCall(new Error(`CDP ${method} timed out`));
			}, 10000);
			this.#pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
			this.#socket.send(JSON.stringify({ id, method, params: params ?? {}, ...(sessionId ? { sessionId } : {}) }));
		});
	}

	async close() {
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error("CDP connection closed"));
		}
		this.#pending.clear();
		if (this.#socket.readyState === WebSocket.CLOSED) return;
		const closed = once(this.#socket, "close");
		this.#socket.close();
		await timeout(closed, 3000, "CDP websocket close");
	}
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = join(root, "extension");
const executable =
	process.env.APPLE_CUA_BROWSER_QA_EXECUTABLE ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const loadViaCdp = process.env.APPLE_CUA_BROWSER_QA_LOAD_VIA_CDP === "1";
const headless = process.env.APPLE_CUA_BROWSER_QA_HEADLESS === "1";
const nativePairing = process.env.APPLE_CUA_BROWSER_QA_NATIVE_PAIRING === "1";
const ownedDirs = [];
const ownedTabs = new Set();
let browser;
let browserCdp;
let browserPid;
let browserLog;
let bridge;
let fixture;
let fixtureUrl;
let session;
let cliStateDir;

async function cliCall(input) {
	const child = spawn(
		process.execPath,
		[resolve(root, "../../skills/apple-cua-browser/scripts/browser.mjs"), "call", JSON.stringify(input)],
		{
			env: { ...process.env, APPLE_CUA_STATE_DIR: cliStateDir },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (data) => {
		stdout += data.toString();
	});
	child.stderr.on("data", (data) => {
		stderr += data.toString();
	});
	const closed = once(child, "close");
	let code;
	try {
		[code] = await timeout(closed, 20000, "CLI call");
	} catch (error) {
		child.kill("SIGKILL");
		await closed;
		throw error;
	}
	assert(code === 0, `CLI failed: ${stderr}`);
	return JSON.parse(stdout);
}

const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

try {
	const userDataDir = await mkdtemp(join(tmpdir(), "apple-cua-browser-qa-profile-"));
	ownedDirs.push(userDataDir);
	const stopDir = await mkdtemp(join(tmpdir(), "apple-cua-browser-qa-stop-"));
	ownedDirs.push(stopDir);
	const stopSwitch = new StopSwitch(stopDir);
	cliStateDir = stopDir;

	fixture = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(`<!doctype html><title>Browser QA fixture</title>
			<label>Value <input id="value" value="old"></label>
			<input id="secret" type="password" value="synthetic-secret-never-observe">
			<button id="apply">Apply</button><p role="status">Ready</p>
			<div id="shadow-host"></div>
			<p style="margin-top:1800px">Bottom marker</p>
			<script>
				const status = document.querySelector('[role=status]');
				document.querySelector('#apply').addEventListener('click', () => {
					status.textContent = 'Applied ' + document.querySelector('#value').value;
				});
				document.querySelector('#value').addEventListener('keydown', (event) => {
					if (event.key === 'Enter') status.textContent = 'Enter verified';
				});
				const root = document.querySelector('#shadow-host').attachShadow({mode:'open'});
				root.innerHTML = '<button>Shadow apply</button>';
				root.querySelector('button').addEventListener('click', () => status.textContent = 'Shadow applied');
			</script>`);
	});
	await new Promise((resolveListen, rejectListen) => {
		fixture.once("error", rejectListen);
		fixture.listen(0, "127.0.0.1", resolveListen);
	});
	const fixtureAddress = fixture.address();
	assert(fixtureAddress && typeof fixtureAddress !== "string", "Fixture failed to bind an ephemeral port");
	fixtureUrl = `http://127.0.0.1:${fixtureAddress.port}/`;

	bridge = new BrowserBridge(stopSwitch, 10000);
	const bridgePort = await bridge.listen(0);
	const controller = new BrowserController(bridge);
	bridge.setRpcHandler((input, signal) => controller.dispatch(input, signal));
	await writeConnection({ port: bridgePort, token: bridge.token }, stopDir);
	let nativeHostPaths;
	if (nativePairing) {
		const nativeDirectory = join(userDataDir, "NativeMessagingHosts");
		await mkdir(nativeDirectory, { recursive: true, mode: 0o700 });
		const nativePaths = {
			nativeHostManifest: join(nativeDirectory, `${NATIVE_HOST_NAME}.json`),
			nativeHostProgram: join(root, "dist/native-host.js"),
			nativeHostLauncher: join(stopDir, "native-host-launcher"),
			stateDirectory: stopDir,
			launchAgent: join(stopDir, "unused.plist"),
			cliProgram: join(root, "dist/cli.js"),
			logDirectory: stopDir,
			stdoutLog: join(stopDir, "stdout"),
			stderrLog: join(stopDir, "stderr"),
		};
		await writeFile(nativePaths.nativeHostLauncher, renderNativeHostLauncher(nativePaths, process.execPath));
		await chmod(nativePaths.nativeHostLauncher, 0o700);
		await writeFile(nativePaths.nativeHostManifest, renderNativeHostManifest(nativePaths), {
			flag: "wx",
			mode: 0o600,
		});
		nativeHostPaths = nativePaths;
	}
	const onboardingStarted = performance.now();
	const extensionReady = new Promise((resolveReady) => bridge.once("connected", resolveReady));
	const browserArgs = [
		...(headless ? ["--headless=new"] : ["--no-startup-window", "--start-minimized"]),
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-gpu",
		...(nativePairing ? ["--enable-logging=stderr", "--log-level=1"] : []),
		`--user-data-dir=${userDataDir}`,
		"--remote-debugging-port=0",
		...(!loadViaCdp ? [`--load-extension=${extensionDir}`, `--disable-extensions-except=${extensionDir}`] : []),
		...(loadViaCdp ? ["--enable-unsafe-extension-debugging"] : []),
		...(headless ? ["about:blank"] : []),
	];
	let devtoolsUrl;
	if (headless) {
		browser = spawn(executable, browserArgs, { stdio: ["ignore", "pipe", "pipe"] });
		devtoolsUrl = await waitForLine(
			[browser.stderr, browser.stdout],
			/DevTools listening on (ws:\/\/[^\s]+)/,
			15000,
			"Chromium DevTools startup",
		);
	} else {
		assert(process.platform === "darwin", "Background GUI verification requires macOS; use headless elsewhere");
		const ready = waitForDevtools(userDataDir);
		try {
			const log = join(userDataDir, "browser.log");
			browserLog = log;
			browser = spawn(
				"/usr/bin/open",
				[
					"-g",
					"-n",
					"-W",
					"--stdout",
					log,
					"--stderr",
					log,
					"-a",
					resolve(dirname(executable), "../.."),
					"--args",
					...browserArgs,
				],
				{ stdio: ["ignore", "pipe", "pipe"] },
			);
			devtoolsUrl = await ready.promise;
		} finally {
			ready.close();
		}
	}
	browserCdp = await Cdp.connect(devtoolsUrl);
	const processInfo = await browserCdp.call("SystemInfo.getProcessInfo");
	browserPid = processInfo.processInfo.find((process) => process.type === "browser")?.id;
	const browserVersion = await browserCdp.call("Browser.getVersion");
	const loadedExtension = loadViaCdp
		? await browserCdp.call("Extensions.loadUnpacked", { path: extensionDir })
		: undefined;

	const targetChange = new Promise((resolveTarget) => {
		const unsubscribe = browserCdp.on("Target.targetCreated", (event) => {
			if (event.targetInfo.type === "service_worker" && event.targetInfo.url.includes("background.js")) {
				unsubscribe();
				resolveTarget(event.targetInfo);
			}
		});
	});
	await browserCdp.call("Target.setDiscoverTargets", { discover: true });
	const targets = await browserCdp.call("Target.getTargets");
	const worker =
		targets.targetInfos.find((target) => target.type === "service_worker" && target.url.includes("background.js")) ??
		(loadedExtension ? undefined : await timeout(targetChange, 10000, "extension service worker discovery"));
	const extensionOrigin = loadedExtension
		? `chrome-extension://${loadedExtension.id}`
		: `chrome-extension://${new URL(worker.url).host}`;
	if (nativeHostPaths !== undefined) {
		// Authorize only the actual loaded extension in this disposable profile.
		const extensionId = new URL(extensionOrigin).host;
		await writeFile(nativeHostPaths.nativeHostManifest, renderNativeHostManifest(nativeHostPaths, extensionId));
		await writeFile(
			nativeHostPaths.nativeHostLauncher,
			renderNativeHostLauncher(nativeHostPaths, process.execPath, extensionId),
		);
	}
	browserCdp.on("Runtime.exceptionThrown", (event) => {
		process.stderr.write(
			`Worker exception: ${event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text}\n`,
		);
	});
	if (worker) {
		const attached = await browserCdp.call("Target.attachToTarget", { targetId: worker.targetId, flatten: true });
		await browserCdp.call("Runtime.enable", {}, attached.sessionId);
	}
	const optionsTarget = await browserCdp.call("Target.createTarget", {
		url: "about:blank",
		background: true,
		newWindow: true,
		...(headless ? {} : { windowState: "minimized" }),
	});
	const optionsAttached = await browserCdp.call("Target.attachToTarget", {
		targetId: optionsTarget.targetId,
		flatten: true,
	});
	await browserCdp.call("Page.enable", {}, optionsAttached.sessionId);
	const optionsLoaded = new Promise((resolveLoaded) => {
		const unsubscribe = browserCdp.on("Page.loadEventFired", () => {
			unsubscribe();
			resolveLoaded();
		});
	});
	const navigation = await browserCdp.call(
		"Page.navigate",
		{ url: `${extensionOrigin}/options.html` },
		optionsAttached.sessionId,
	);
	assert(!navigation.errorText, `Options navigation failed: ${navigation.errorText}`);
	await timeout(optionsLoaded, 10000, "extension options loading");
	const pairingResult = await browserCdp.call(
		"Runtime.evaluate",
		{
			expression: nativePairing
				? `(async()=>{const response=await chrome.runtime.sendNativeMessage(${JSON.stringify(NATIVE_HOST_NAME)},{method:'connection'});return {port:response.port}})()`
				: `document.querySelector('#port').value=${bridgePort};document.querySelector('#token').value=${JSON.stringify(bridge.token)};document.querySelector('#settings').requestSubmit()`,
			awaitPromise: nativePairing,
			returnByValue: nativePairing,
		},
		optionsAttached.sessionId,
	);
	assert(!pairingResult.exceptionDetails, `Options pairing failed: ${JSON.stringify(pairingResult.exceptionDetails)}`);
	if (nativePairing)
		assert(
			pairingResult.result.value.port === bridgePort,
			"Native messaging did not resolve the isolated QA profile",
		);
	await timeout(extensionReady, 10000, "extension bridge connection");
	const onboardingMs = performance.now() - onboardingStarted;
	process.stdout.write("QA_STAGE paired\n");
	const waitUiState = (state) =>
		browserCdp.call(
			"Runtime.evaluate",
			{
				expression: `new Promise((resolve,reject)=>{const node=document.querySelector('#status');if(node.dataset.state===${JSON.stringify(state)})return resolve(true);const observer=new MutationObserver(()=>{if(node.dataset.state===${JSON.stringify(state)}){clearTimeout(timer);observer.disconnect();resolve(true)}});const timer=setTimeout(()=>{observer.disconnect();reject(Error('UI state deadline'))},3000);observer.observe(node,{attributes:true,attributeFilter:['data-state']})})`,
				awaitPromise: true,
				returnByValue: true,
			},
			optionsAttached.sessionId,
		);
	await waitUiState("connected");
	const userWindowResult = await browserCdp.call(
		"Runtime.evaluate",
		{
			expression:
				"(async()=>{const w=await chrome.windows.getCurrent();const [tab]=await chrome.tabs.query({windowId:w.id,active:true});globalThis.__qaFocusEvents=[];chrome.windows.onFocusChanged.addListener(id=>globalThis.__qaFocusEvents.push(id));return {id:w.id,focused:w.focused,tabId:tab.id}})()",
			awaitPromise: true,
			returnByValue: true,
		},
		optionsAttached.sessionId,
	);
	const userWindow = userWindowResult.result.value;

	session = new BrowserSession(bridge);
	const rows = [];
	let staleTab;
	for (let i = 0; i < 5; i++) {
		process.stdout.write(`QA_STAGE fixture ${i}\n`);
		const opened = await session.open(`${fixtureUrl}?case=${i}`);
		ownedTabs.add(opened.tabId);
		const startObserve = performance.now();
		const observed = await session.observe(opened.tabId, undefined, true);
		const observeMs = performance.now() - startObserve;
		assert(observed.format === "full", `Tab ${i} did not return a full observation`);
		assert(
			!JSON.stringify(observed).includes("synthetic-secret-never-observe"),
			"Password value leaked into observation",
		);
		const field = observed.rows.find((row) => row.role === "textbox" && row.name === "Value");
		const button = observed.rows.find((row) => row.role === "button" && row.name === "Apply");
		assert(field && button, `Tab ${i} observation lacks fixture input/button refs`);
		const startRun = performance.now();
		const result = await session.run(
			opened.tabId,
			observed.observation_token,
			[
				{ action: "fill", ref: field.ref, text: `probe${i}` },
				{ action: "click", ref: button.ref },
			],
			{ text: `Applied probe${i}`, timeoutMs: 3000 },
		);
		const runMs = performance.now() - startRun;
		assert(result.verified === true, `Tab ${i} fixture action was not verified`);
		const status = result.changed?.find((row) => row.role === "status");
		assert(status?.name === `Applied probe${i}`, `Tab ${i} returned unexpected status: ${status?.name}`);
		const backgroundResult = await browserCdp.call(
			"Runtime.evaluate",
			{
				expression: `(async()=>{const tab=await chrome.tabs.get(${opened.tabId});const agent=await chrome.windows.get(tab.windowId);const user=await chrome.windows.get(${userWindow.id});const [active]=await chrome.tabs.query({windowId:user.id,active:true});return {agentId:agent.id,minimized:agent.state==='minimized',agentFocused:agent.focused,userFocused:user.focused,activeTabId:active.id,focusEvents:globalThis.__qaFocusEvents}})()`,
				awaitPromise: true,
				returnByValue: true,
			},
			optionsAttached.sessionId,
		);
		const background = backgroundResult.result.value;
		assert(
			background.agentId !== userWindow.id && background.minimized && !background.agentFocused,
			"Agent input left its minimized background window",
		);
		assert(
			background.userFocused === userWindow.focused && background.activeTabId === userWindow.tabId,
			"Agent input changed the user window or selected tab",
		);
		assert(!background.focusEvents.includes(background.agentId), "Agent window took focus during input");
		let replayRejected = false;
		try {
			await session.run(opened.tabId, observed.observation_token, [{ action: "click", ref: button.ref }], undefined);
		} catch (error) {
			replayRejected = error?.code === "stale";
		}
		assert(replayRejected, `Tab ${i} accepted a replayed observation token`);
		const startDelta = performance.now();
		const delta = await session.observe(opened.tabId);
		const deltaMs = performance.now() - startDelta;
		assert(delta.format === "delta", `Tab ${i} unchanged observation was not a delta`);
		assert(
			Buffer.byteLength(JSON.stringify(delta)) < Buffer.byteLength(JSON.stringify(observed)),
			`Tab ${i} delta was not smaller than full output`,
		);
		assert(!JSON.stringify(delta).includes("synthetic-secret-never-observe"), "Password value leaked into delta");
		rows.push({
			tab: i,
			observeMs,
			runMs,
			deltaMs,
			fullBytes: Buffer.byteLength(JSON.stringify(observed)),
			deltaBytes: Buffer.byteLength(JSON.stringify(delta)),
		});
		if (i === 3) staleTab = opened.tabId;
	}

	const shadowTab = [...ownedTabs][0];
	const shadowObservation = await session.observe(shadowTab, undefined, true);
	const shadowButton = shadowObservation.rows.find((row) => row.role === "button" && row.name === "Shadow apply");
	assert(shadowButton, "Shadow-root button was not observed");
	const shadowResult = await session.run(
		shadowTab,
		shadowObservation.observation_token,
		[{ action: "click", ref: shadowButton.ref }],
		{ text: "Shadow applied", timeoutMs: 3000 },
	);
	assert(shadowResult.verified === true, "Shadow-root button click was not verified");
	assert(
		shadowResult.changed?.some((row) => row.role === "status" && row.name === "Shadow applied"),
		"Shadow click returned wrong status",
	);

	const stoppedTab = [...ownedTabs][1];
	const stopObservation = await session.observe(stoppedTab, undefined, true);
	stopSwitch.stop("Browser QA stop-gate check", "api");
	let stoppedMutation = false;
	try {
		const apply = stopObservation.rows.find((row) => row.role === "button" && row.name === "Apply");
		assert(apply, "Stop-test Apply button missing");
		await session.run(
			stoppedTab,
			stopObservation.observation_token,
			[{ action: "click", ref: apply.ref }],
			undefined,
		);
	} catch (error) {
		stoppedMutation = error?.code === "stopped";
		if (!stoppedMutation && error?.message !== "Browser QA stop-gate check") throw error;
	}
	assert(stoppedMutation, "StopSwitch did not refuse mutation");
	const allowedObservation = await session.observe(stoppedTab);
	assert(allowedObservation.format === "delta", "StopSwitch incorrectly blocked observation");
	stopSwitch.resume();

	assert(staleTab !== undefined, "No stale-revision fixture tab was created");
	const staleObservation = await session.observe(staleTab, undefined, true);
	const staleButton = staleObservation.rows.find((row) => row.role === "button" && row.name === "Apply");
	assert(staleButton, "Stale-revision Apply button missing");
	const pageTarget = (await browserCdp.call("Target.getTargets")).targetInfos.find(
		(target) => target.url === `${fixtureUrl}?case=3`,
	);
	assert(pageTarget, "Could not find owned fixture target in CDP");
	const pageAttach = await browserCdp.call("Target.attachToTarget", { targetId: pageTarget.targetId, flatten: true });
	await browserCdp.call(
		"Runtime.evaluate",
		{
			expression: `document.querySelector('[role=status]').textContent='Debugger changed status'`,
			returnByValue: true,
		},
		pageAttach.sessionId,
	);
	let staleRejected = false;
	try {
		await session.run(
			staleTab,
			staleObservation.observation_token,
			[{ action: "click", ref: staleButton.ref }],
			undefined,
		);
	} catch (error) {
		staleRejected = error?.code === "extension" && /Stale observation revision/.test(error.message);
	}
	assert(staleRejected, "DOM revision change did not reject the prior observation");
	const cliOpened = await cliCall({ action: "open", space: "cli-qa", url: `${fixtureUrl}?case=cli` });
	assert(cliOpened.page === "p1", "CLI task space did not return a permanent page label");
	const cliObserved = await cliCall({ action: "observe", space: "cli-qa", page: "p1" });
	const cliField = cliObserved.rows.find((row) => row.role === "textbox" && row.name === "Value");
	const cliButton = cliObserved.rows.find((row) => row.role === "button" && row.name === "Apply");
	assert(cliField && cliButton, "CLI observation lacks the fixture controls");
	const cliResult = await cliCall({
		action: "run",
		space: "cli-qa",
		page: "p1",
		observation_token: cliObserved.observation_token,
		steps: [
			{ action: "fill", ref: cliField.ref, text: "cli" },
			{ action: "click", ref: cliButton.ref },
		],
		expect: { text: "Applied cli", timeoutMs: 3000 },
	});
	assert(
		cliResult.verified === true && cliResult.changed.some((row) => row.name === "Applied cli"),
		"CLI flow did not verify its exact result",
	);
	const keyResult = await cliCall({
		action: "run",
		space: "cli-qa",
		page: "p1",
		observation_token: cliResult.observation_token,
		steps: [{ action: "press", ref: cliField.ref, key: "Enter" }],
		expect: { text: "Enter verified", timeoutMs: 3000 },
	});
	assert(keyResult.verified === true, "CLI keyboard input did not verify");
	const scrollResult = await cliCall({
		action: "run",
		space: "cli-qa",
		page: "p1",
		observation_token: keyResult.observation_token,
		steps: [{ action: "scroll", deltaY: 2500 }],
	});
	assert(
		scrollResult.changed.some((row) => row.name === "Bottom marker"),
		"Scroll did not reveal the off-screen marker",
	);
	await cliCall({ action: "finish", space: "cli-qa" });
	if (!headless) {
		// Minimized native windows do not composite screenshots. Restore only
		// this disposable options window, without activating the browser.
		const optionsWindow = await browserCdp.call("Browser.getWindowForTarget", {
			targetId: optionsTarget.targetId,
		});
		await browserCdp.call("Browser.setWindowBounds", {
			windowId: optionsWindow.windowId,
			bounds: { windowState: "normal" },
		});
		const focus = await browserCdp.call(
			"Runtime.evaluate",
			{
				expression: "(async()=>({focused:(await chrome.windows.getCurrent()).focused}))()",
				awaitPromise: true,
				returnByValue: true,
			},
			optionsAttached.sessionId,
		);
		assert(focus.result.value.focused === false, "QA options rendering activated the background browser");
	}
	const evidenceRoot = resolve(root, "../../.omo/evidence/apple-cua-browser");
	await mkdir(evidenceRoot, { recursive: true });
	const evidenceDir = await mkdtemp(join(evidenceRoot, "run-"));
	const screenshots = [];
	await browserCdp.call("Emulation.setFocusEmulationEnabled", { enabled: true }, optionsAttached.sessionId);
	await browserCdp.call(
		"Runtime.evaluate",
		{
			expression: "document.querySelector('details').open=false;document.body.tabIndex=-1;document.body.focus()",
		},
		optionsAttached.sessionId,
	);
	const keyboardFocus = [];
	for (const expected of ["stop", "SUMMARY", "port", "token", "BUTTON"]) {
		const nextFocus = browserCdp.call(
			"Runtime.evaluate",
			{
				expression: `new Promise((resolve,reject)=>{const timer=setTimeout(()=>{document.removeEventListener('focusin',onFocus);reject(Error('Focus deadline'))},3000);function onFocus(event){clearTimeout(timer);document.removeEventListener('focusin',onFocus);resolve(event.target.id||event.target.tagName)}document.addEventListener('focusin',onFocus)})`,
				awaitPromise: true,
				returnByValue: true,
			},
			optionsAttached.sessionId,
		);
		await browserCdp.call(
			"Input.dispatchKeyEvent",
			{ type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
			optionsAttached.sessionId,
		);
		await browserCdp.call(
			"Input.dispatchKeyEvent",
			{ type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
			optionsAttached.sessionId,
		);
		const focus = await nextFocus;
		assert(focus.result.value === expected, `Options keyboard focus mismatch: ${focus.result.value}`);
		keyboardFocus.push(focus.result.value);
		if (expected === "SUMMARY") {
			await browserCdp.call(
				"Input.dispatchKeyEvent",
				{ type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
				optionsAttached.sessionId,
			);
			await browserCdp.call(
				"Input.dispatchKeyEvent",
				{ type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 },
				optionsAttached.sessionId,
			);
		}
	}
	const pausedUi = waitUiState("paused");
	const pauseResult = await browserCdp.call(
		"Runtime.evaluate",
		{
			expression: `new Promise((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);chrome.storage.onChanged.removeListener(changed)};const changed=(changes,area)=>{if(area==='local'&&changes.pausedByUser?.newValue===true){cleanup();resolve(true)}};const timer=setTimeout(()=>{cleanup();reject(Error('Persisted pause deadline'))},3000);chrome.storage.onChanged.addListener(changed);chrome.runtime.sendMessage({type:'stop'}).catch(error=>{cleanup();reject(error)})})`,
			awaitPromise: true,
			returnByValue: true,
		},
		optionsAttached.sessionId,
	);
	assert(pauseResult.result.value === true, "Human browser pause was not persisted");
	await pausedUi;
	for (const scheme of ["light", "dark"]) {
		await browserCdp.call(
			"Emulation.setDeviceMetricsOverride",
			{ width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
			optionsAttached.sessionId,
		);
		await browserCdp.call(
			"Emulation.setEmulatedMedia",
			{ features: [{ name: "prefers-color-scheme", value: scheme }] },
			optionsAttached.sessionId,
		);
		const image = await browserCdp.call("Page.captureScreenshot", { format: "png" }, optionsAttached.sessionId);
		const path = join(evidenceDir, `options-390-${scheme}-paused-focus.png`);
		await writeFile(path, Buffer.from(image.data, "base64"));
		screenshots.push(path);
	}
	let userPauseRejected = false;
	try {
		await session.open(fixtureUrl);
	} catch (error) {
		userPauseRejected =
			error?.code === "stopped" || (error?.code === "extension" && /Actions stopped/.test(error.message));
	}
	assert(userPauseRejected, "Human browser pause did not refuse new input");
	const resumed = new Promise((resolveReady) => bridge.once("connected", resolveReady));
	await browserCdp.call(
		"Runtime.evaluate",
		{
			expression: nativePairing
				? `document.querySelector('#connect-local').click()`
				: `document.querySelector('#settings').requestSubmit()`,
		},
		optionsAttached.sessionId,
	);
	await timeout(resumed, 10000, "human browser resume");
	await waitUiState("connected");
	// Reconnection invalidates old host ownership. The disposable browser owns
	// these abandoned QA tabs and will remove them during process cleanup.
	ownedTabs.clear();
	for (const width of [390, 1440, 1920]) {
		for (const scheme of ["light", "dark"]) {
			for (const expanded of [false, true]) {
				await browserCdp.call(
					"Runtime.evaluate",
					{
						expression: `document.querySelector('details').open=${expanded}`,
					},
					optionsAttached.sessionId,
				);
				await browserCdp.call(
					"Emulation.setDeviceMetricsOverride",
					{
						width,
						height: 844,
						deviceScaleFactor: 1,
						mobile: width === 390,
					},
					optionsAttached.sessionId,
				);
				await browserCdp.call(
					"Emulation.setEmulatedMedia",
					{
						features: [{ name: "prefers-color-scheme", value: scheme }],
					},
					optionsAttached.sessionId,
				);
				const image = await browserCdp.call("Page.captureScreenshot", { format: "png" }, optionsAttached.sessionId);
				const path = join(evidenceDir, `options-${width}-${scheme}-${expanded ? "manual" : "automatic"}.png`);
				await writeFile(path, Buffer.from(image.data, "base64"));
				screenshots.push(path);
			}
		}
	}
	const disconnectedUi = waitUiState("disconnected");
	await bridge.close();
	bridge = undefined;
	await disconnectedUi;
	for (const scheme of ["light", "dark"]) {
		await browserCdp.call(
			"Emulation.setDeviceMetricsOverride",
			{ width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
			optionsAttached.sessionId,
		);
		await browserCdp.call(
			"Emulation.setEmulatedMedia",
			{ features: [{ name: "prefers-color-scheme", value: scheme }] },
			optionsAttached.sessionId,
		);
		await browserCdp.call(
			"Runtime.evaluate",
			{
				expression: "document.querySelector('details').open=false;document.querySelector('#connect-local').focus()",
			},
			optionsAttached.sessionId,
		);
		const image = await browserCdp.call("Page.captureScreenshot", { format: "png" }, optionsAttached.sessionId);
		const path = join(evidenceDir, `options-390-${scheme}-disconnected-focus.png`);
		await writeFile(path, Buffer.from(image.data, "base64"));
		screenshots.push(path);
	}
	const report = {
		browser: browserVersion.product,
		observations: rows,
		screenshots,
		cliVerified: true,
		backgroundVerified: true,
		nativePairingVerified: nativePairing,
		onboardingMs,
		keyboardFocus,
		keyboardVerified: true,
		verified: true,
	};
	await writeFile(join(evidenceDir, "report.json"), JSON.stringify(report, null, 2));
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
	if (browserLog !== undefined) {
		await readFile(browserLog, "utf8").then(
			(log) => {
				process.stderr.write(
					`${log
						.split("\n")
						.filter((line) => /native_messag|launch_context/.test(line))
						.join("\n")}\n`,
				);
			},
			(logError) => process.stderr.write(`Browser diagnostics unavailable: ${logError.message}\n`),
		);
	}
	throw error;
} finally {
	for (const tabId of ownedTabs) {
		try {
			await session?.close(tabId);
		} catch (error) {
			process.stderr.write(
				`Failed closing owned fixture target ${tabId}: ${error instanceof Error ? error.message : String(error)}\n`,
			);
			process.exitCode = 1;
		}
	}
	await bridge?.close();
	if (fixture)
		await new Promise((resolveClose, rejectClose) =>
			fixture.close((error) => (error ? rejectClose(error) : resolveClose())),
		);
	if (browser && browser.exitCode === null) {
		const exited = once(browser, "exit");
		try {
			await browserCdp?.call("Browser.close");
			await timeout(exited, 5000, "browser process exit");
		} catch {
			if (Number.isSafeInteger(browserPid)) process.kill(browserPid, "SIGTERM");
			browser.kill("SIGTERM");
			await timeout(exited, 5000, "browser process teardown");
		}
	}
	await browserCdp?.close();
	for (const directory of ownedDirs) await rm(directory, { recursive: true, force: true });
}
