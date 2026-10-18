const DEFAULT_PORT = 47953;
const MAX_MESSAGE = 256_000;
const CHECKPOINT_TIMEOUT_MS = 10_000;
import { pageRuntime } from "./page-runtime.js";

const PAGE_RUNTIME = String(pageRuntime);
const tabsOwned = new Map();
const queues = new Map();
let agentWindowId;
let agentBlankTabId;
let openingWindow;
let socket;
let ready = false;
let stopped = true;
let heartbeat;
let connecting = false;
let reconnectRequested = false;
let pausedByUser = false;
const checkpoints = new Map();

function send(value) {
	if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function rejectCheckpoints(reason) {
	for (const waiter of checkpoints.values()) {
		clearTimeout(waiter.timer);
		waiter.reject(new Error(reason));
	}
	checkpoints.clear();
}

function stopLocally() {
	stopped = true;
	rejectCheckpoints("Actions stopped");
	for (const state of tabsOwned.values()) state.cancelled = true;
	void chrome.storage.session.set({
		bridgeConnected: ready,
		bridgeStopped: true,
		bridgePausedByUser: pausedByUser,
	});
}

async function localConnection() {
	const connection = await chrome.runtime.sendNativeMessage("com.browser_skill_omo.bridge", {
		method: "connection",
	});
	if (
		!isRecord(connection) ||
		!Number.isInteger(connection.port) ||
		connection.port < 1 ||
		connection.port > 65535 ||
		typeof connection.token !== "string" ||
		!/^[0-9a-f]{64}$/i.test(connection.token)
	)
		throw new Error("Install the local Browser-Skill-OmO service before connecting.");
	return { port: connection.port, token: connection.token };
}

async function connect() {
	if (connecting || (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)))
		return;
	connecting = true;
	let settings;
	try {
		settings = await chrome.storage.local.get(["port", "token", "pausedByUser"]);
		if (!settings.token) {
			try {
				const connection = await localConnection();
				await chrome.storage.local.set(connection);
				settings = { ...settings, port: connection.port, token: connection.token };
			} catch {
				// Manual pairing remains available when no native host is installed.
				return;
			}
		}
		pausedByUser = pausedByUser || settings.pausedByUser === true;
	} finally {
		connecting = false;
	}
	const { port = DEFAULT_PORT, token } = settings;
	if (typeof token !== "string" || !token) return;
	const ws = new WebSocket(`ws://127.0.0.1:${port}`);
	socket = ws;
	ready = false;
	stopped = true;
	ws.addEventListener("open", () => ws.send(JSON.stringify({ token })));
	ws.addEventListener("message", (event) => {
		if (typeof event.data !== "string" || event.data.length > MAX_MESSAGE) {
			ws.close(1009, "Invalid message size");
			return;
		}
		let message;
		try {
			message = JSON.parse(event.data);
		} catch {
			ws.close(1007, "Invalid JSON");
			return;
		}
		if (!isRecord(message)) return;
		if (message.ready === true) {
			ready = true;
			stopped = pausedByUser;
			void chrome.storage.session.set({
				bridgeConnected: true,
				bridgeStopped: stopped,
				bridgePausedByUser: pausedByUser,
			});
			if (stopped) send({ event: "stop" });
			clearInterval(heartbeat);
			heartbeat = setInterval(() => send({ event: "heartbeat" }), 20000);
			return;
		}
		if (typeof message.checkpoint === "string" && typeof message.allowed === "boolean") {
			const waiter = checkpoints.get(message.checkpoint);
			if (waiter) {
				clearTimeout(waiter.timer);
				checkpoints.delete(message.checkpoint);
				waiter.resolve(message.allowed);
			}
			return;
		}
		if (typeof message.id === "string" && isRecord(message.command)) {
			const command = { ...message.command, command: message.command.method, id: message.id };
			if (validCommand(command)) void handleCommand(command);
			else send({ id: message.id, ok: false, error: "Invalid command" });
		}
	});
	ws.addEventListener("close", () => {
		if (socket === ws) {
			socket = undefined;
			ready = false;
			clearInterval(heartbeat);
			stopLocally();
			void chrome.storage.session.set({ bridgeConnected: false });
			if (reconnectRequested) {
				reconnectRequested = false;
				void connect();
			}
		}
	});
	ws.addEventListener("error", () => ws.close());
}

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validLimits(value) {
	return (
		isRecord(value) &&
		Number.isInteger(value.maxChars) &&
		value.maxChars >= 256 &&
		value.maxChars <= 20_000 &&
		Number.isInteger(value.maxElements) &&
		value.maxElements >= 1 &&
		value.maxElements <= 200 &&
		typeof value.fullPage === "boolean"
	);
}

function validStep(step) {
	if (!isRecord(step) || !Number.isInteger(step.ref) || step.ref <= 0) {
		return (
			isRecord(step) && step.action === "scroll" && Number.isFinite(step.deltaY) && Math.abs(step.deltaY) <= 5000
		);
	}
	if (step.action === "click") return Object.keys(step).length === 2;
	if (step.action === "fill") return typeof step.text === "string" && step.text.length <= 10_000;
	return step.action === "press" && ["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp"].includes(step.key);
}

function validCommand(command) {
	if (typeof command.id !== "string" || command.id.length < 1 || command.id.length > 128) return false;
	if (command.command === "stop") return true;
	if (command.command === "open")
		return typeof command.url === "string" && command.url.length <= 8192 && /^https?:\/\//i.test(command.url);
	if (command.command === "close" || command.command === "observe") {
		return (
			Number.isInteger(command.tabId) &&
			command.tabId > 0 &&
			(command.command === "close" || validLimits(command.limits))
		);
	}
	return (
		command.command === "run" &&
		Number.isInteger(command.tabId) &&
		command.tabId > 0 &&
		typeof command.revision === "string" &&
		command.revision.length <= 256 &&
		Array.isArray(command.steps) &&
		command.steps.length >= 1 &&
		command.steps.length <= 12 &&
		command.steps.every(validStep) &&
		validLimits(command.limits) &&
		(command.expect === undefined ||
			(isRecord(command.expect) &&
				typeof command.expect.text === "string" &&
				command.expect.text.length >= 1 &&
				command.expect.text.length <= 500 &&
				Number.isInteger(command.expect.timeoutMs) &&
				command.expect.timeoutMs >= 1 &&
				command.expect.timeoutMs <= 10_000))
	);
}

function enqueue(tabId, action) {
	const previous = queues.get(tabId) ?? Promise.resolve();
	const current = previous.then(action, action);
	queues.set(tabId, current);
	return current.finally(() => {
		if (queues.get(tabId) === current) queues.delete(tabId);
	});
}

async function handleCommand(message) {
	if (!ready || !socket || socket.readyState !== WebSocket.OPEN) return;
	try {
		const value = await dispatch(message);
		send({ id: message.id, ok: true, value });
	} catch (error) {
		send({
			id: message.id,
			ok: false,
			error: error instanceof Error ? error.message.slice(0, 2000) : "Extension error",
		});
	}
}

async function dispatch(command) {
	if (command.command === "stop") {
		stopLocally();
		return null;
	}
	if (!ready || (stopped && command.command !== "observe" && command.command !== "close"))
		throw new Error("Actions stopped");
	if (command.command === "open") return openTab(command.url);
	if (command.command === "close") {
		const state = tabsOwned.get(command.tabId);
		if (!state) throw new Error("Tab is not agent-owned");
		const tab = await chrome.tabs.get(command.tabId);
		if (tab.windowId !== state.windowId || state.windowId !== agentWindowId)
			throw new Error("Agent tab moved out of its background window");
		state.cancelled = true;
		await chrome.tabs.remove(command.tabId);
		tabsOwned.delete(command.tabId);
		if (tabsOwned.size === 0 && agentWindowId !== undefined && agentBlankTabId !== undefined) {
			const remaining = await chrome.tabs.query({ windowId: agentWindowId });
			if (remaining.length === 1 && remaining[0].id === agentBlankTabId) {
				const windowId = agentWindowId;
				agentWindowId = undefined;
				agentBlankTabId = undefined;
				await chrome.windows.remove(windowId);
			}
		}
		return null;
	}
	return enqueue(command.tabId, async () => {
		const state = requireOwned(command.tabId);
		if (command.command === "observe") return observe(state, command.limits);
		return enqueue(`window:${state.windowId}`, () => runSteps(state, command));
	});
}

async function openTab(url) {
	const parsed = new URL(url);
	if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP(S) URLs are allowed");
	if (agentWindowId === undefined) {
		openingWindow ??= chrome.windows
			.create({ url: "about:blank", focused: false, state: "minimized" })
			.then(async (window) => {
				if (!Number.isInteger(window?.id)) throw new Error("Could not create the background agent window");
				// macOS Chromium may ignore state in create(). Apply it before the
				// window becomes an input target and before any page is loaded.
				await chrome.windows.update(window.id, { state: "minimized" });
				const background = await chrome.windows.get(window.id);
				if (background.state !== "minimized" || background.focused) {
					await chrome.windows.remove(window.id);
					throw new Error("Chromium could not create a minimized background window");
				}
				agentWindowId = window.id;
				agentBlankTabId = window.tabs?.[0]?.id;
			});
		try {
			await openingWindow;
		} finally {
			openingWindow = undefined;
		}
	}
	const tab = await chrome.tabs.create({ windowId: agentWindowId, url: parsed.href, active: false });
	const state = {
		tabId: tab.id,
		windowId: agentWindowId,
		attached: false,
		contextId: undefined,
		contextGeneration: 0,
		frameId: undefined,
		revision: undefined,
		cancelled: false,
	};
	if (typeof tab.id !== "number") throw new Error("Could not create tab");
	tabsOwned.set(tab.id, state);
	try {
		await waitForComplete(tab.id);
		await chrome.debugger.attach({ tabId: tab.id }, "1.3");
		state.attached = true;
		await chrome.debugger.sendCommand({ tabId: tab.id }, "Page.enable");
		await chrome.debugger.sendCommand({ tabId: tab.id }, "Runtime.enable");
		await chrome.debugger.sendCommand({ tabId: tab.id }, "Emulation.setFocusEmulationEnabled", { enabled: true });
		await ensureContext(state);
		return { tabId: tab.id, url: tab.url ?? parsed.href };
	} catch (error) {
		if (tabsOwned.has(tab.id)) {
			tabsOwned.delete(tab.id);
			try {
				await chrome.tabs.remove(tab.id);
			} catch (cleanupError) {
				throw new Error("Failed to clean up the created tab", { cause: cleanupError });
			}
		}
		throw error;
	}
}

function waitForComplete(tabId) {
	return new Promise((resolve, reject) => {
		const listener = (changedId, changeInfo) => {
			if (changedId === tabId && changeInfo.status === "complete") {
				chrome.tabs.onUpdated.removeListener(listener);
				resolve();
			}
		};
		chrome.tabs.onUpdated.addListener(listener);
		chrome.tabs.get(tabId).then(
			(tab) => {
				if (tab.status === "complete") {
					chrome.tabs.onUpdated.removeListener(listener);
					resolve();
				}
			},
			(error) => {
				chrome.tabs.onUpdated.removeListener(listener);
				reject(error);
			},
		);
	});
}

async function ensureContext(state) {
	if (!state.attached) throw new Error("Debugger detached");
	if (state.contextId !== undefined) return state.contextId;
	const tree = await chrome.debugger.sendCommand({ tabId: state.tabId }, "Page.getFrameTree");
	const frame = tree?.frameTree?.frame;
	if (!frame || typeof frame.id !== "string") throw new Error("Main frame unavailable");
	if (state.frameId !== frame.id || !state.contextId) {
		const world = await chrome.debugger.sendCommand({ tabId: state.tabId }, "Page.createIsolatedWorld", {
			frameId: frame.id,
			worldName: "appleCuaBridge",
			grantUniveralAccess: false,
		});
		if (!Number.isInteger(world?.executionContextId)) throw new Error("Isolated context unavailable");
		state.frameId = frame.id;
		state.contextId = world.executionContextId;
		state.contextGeneration++;
		state.revision = undefined;
		const installed = await chrome.debugger.sendCommand({ tabId: state.tabId }, "Runtime.evaluate", {
			expression: `globalThis.__appleCuaPageRuntime = (${PAGE_RUNTIME}); void 0`,
			contextId: state.contextId,
		});
		if (installed.exceptionDetails) throw new Error("Could not install the isolated page runtime");
	}
	return state.contextId;
}

async function evaluate(state, method, args = {}) {
	const contextId = await ensureContext(state);
	const expression = `globalThis.__appleCuaPageRuntime(${JSON.stringify({ method, ...args })})`;
	const result = await chrome.debugger.sendCommand({ tabId: state.tabId }, "Runtime.evaluate", {
		expression,
		contextId,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result.exceptionDetails) throw new Error("Page runtime failed");
	return result.result?.value;
}

async function observe(state, limits) {
	const result = await evaluate(state, "observe", { limits });
	if (!isRecord(result) || typeof result.revision !== "string") throw new Error("Invalid page observation");
	state.revision = result.revision;
	return result;
}

function requireOwned(tabId) {
	const state = tabsOwned.get(tabId);
	if (!state || !state.attached) throw new Error("Tab is not an attached agent-owned tab");
	return state;
}

function checkpoint(commandId, step) {
	if (stopped || !ready) return Promise.resolve(false);
	const id = commandId;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			checkpoints.delete(id);
			reject(new Error("Stop checkpoint timed out"));
		}, CHECKPOINT_TIMEOUT_MS);
		checkpoints.set(id, { resolve, reject, timer });
		send({ event: "checkpoint", id, step });
	});
}

async function runSteps(state, command) {
	const tab = await chrome.tabs.get(state.tabId);
	if (tab.windowId !== state.windowId || state.windowId !== agentWindowId)
		throw new Error("Agent tab moved out of its background window");
	const window = await chrome.windows.get(state.windowId);
	if (window.focused || window.state !== "minimized")
		throw new Error("Background agent window was revealed. Stop and return it to the background before continuing.");
	// CDP emulates renderer focus. Selecting a tab can restore a native minimized
	// window, so agent pages remain inactive and no window focus update occurs.
	let observation = await observe(state, command.limits);
	if (observation.revision !== command.revision) throw new Error("Stale observation revision");
	const contextGeneration = state.contextGeneration;
	let completedSteps = 0;
	for (let index = 0; index < command.steps.length; index++) {
		if (stopped || state.cancelled) throw new Error("Actions stopped");
		if (!(await checkpoint(command.id, index))) throw new Error("Shared stop switch refused remaining steps");
		if (stopped || state.cancelled) throw new Error("Actions stopped");
		const step = command.steps[index];
		if (step.action === "scroll") {
			const prepared = await evaluate(state, "prepareScroll", { deltaY: step.deltaY });
			if (prepared?.ok !== true) throw new Error("Scroll preparation failed");
			if (prepared.needed) await trustedScroll(state, step.deltaY);
			const scrolled = await evaluate(state, "scrollComplete");
			if (scrolled?.ok !== true) throw new Error("Document scroll was not verified");
		} else {
			const target = await evaluate(state, "target", { revision: observation.revision, ref: step.ref });
			if (!isRecord(target) || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
				throw new Error("Stale or missing element reference");
			}
			if (!(await checkpoint(command.id, index)) || stopped || state.cancelled) throw new Error("Actions stopped");
			if (step.action === "click") {
				try {
					await mouse(state, "mousePressed", target.x, target.y);
				} finally {
					await mouse(state, "mouseReleased", target.x, target.y);
				}
			} else if (step.action === "fill") {
				if (target.editable !== true || target.password === true)
					throw new Error("Target is not a permitted editable field");
				const focus = await evaluate(state, "focus", {
					revision: observation.revision,
					ref: step.ref,
					selectAll: true,
					text: step.text,
				});
				if (focus?.ok !== true) throw new Error("Focus refused");
				if (!(await checkpoint(command.id, index)) || stopped || state.cancelled)
					throw new Error("Actions stopped");
				if (step.text === "") await pressKey(state, "Backspace");
				else await chrome.debugger.sendCommand({ tabId: state.tabId }, "Input.insertText", { text: step.text });
				const filled = await evaluate(state, "fillComplete");
				if (filled?.ok !== true) throw new Error("Filled value did not match the requested text");
			} else {
				const focus = await evaluate(state, "focus", { revision: observation.revision, ref: step.ref });
				if (focus?.ok !== true) throw new Error("Focus refused");
				if (!(await checkpoint(command.id, index)) || stopped || state.cancelled)
					throw new Error("Actions stopped");
				await pressKey(state, step.key);
			}
		}
		completedSteps++;
		if (index < command.steps.length - 1) {
			observation = await observe(state, command.limits);
			if (state.contextGeneration !== contextGeneration)
				throw new Error("Document changed during batch; observe before continuing");
		}
	}
	const verification = command.expect
		? await evaluate(state, "verify", { text: command.expect.text, timeoutMs: command.expect.timeoutMs })
		: null;
	observation = await observe(state, command.limits);
	return { observation, verified: verification === null ? null : verification?.ok === true, completedSteps };
}

async function mouse(state, type, x, y) {
	await chrome.debugger.sendCommand({ tabId: state.tabId }, "Input.dispatchMouseEvent", {
		type,
		x,
		y,
		button: "left",
		clickCount: 1,
	});
}

async function trustedScroll(state, deltaY) {
	const metrics = await chrome.debugger.sendCommand({ tabId: state.tabId }, "Page.getLayoutMetrics");
	const viewport = metrics?.cssVisualViewport ?? metrics?.cssLayoutViewport;
	if (!viewport || !Number.isFinite(viewport.clientWidth) || !Number.isFinite(viewport.clientHeight)) {
		throw new Error("Viewport unavailable");
	}
	await chrome.debugger.sendCommand({ tabId: state.tabId }, "Input.dispatchMouseEvent", {
		type: "mouseWheel",
		x: viewport.clientWidth / 2,
		y: viewport.clientHeight / 2,
		deltaX: 0,
		deltaY,
	});
}

const KEY_CODES = {
	Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
	Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
	Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
	ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
	ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
	Control: { key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 },
	A: { key: "a", code: "KeyA", windowsVirtualKeyCode: 65 },
	Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
};

async function keyEvent(state, type, key, modifiers = 0) {
	const values = KEY_CODES[key];
	await chrome.debugger.sendCommand({ tabId: state.tabId }, "Input.dispatchKeyEvent", {
		type,
		...values,
		modifiers,
	});
}

async function pressKey(state, key) {
	try {
		await keyEvent(state, "keyDown", key);
	} finally {
		await keyEvent(state, "keyUp", key);
	}
}

chrome.debugger.onEvent.addListener((source, method) => {
	if (source.tabId === undefined) return;
	const state = tabsOwned.get(source.tabId);
	if (!state) return;
	if (method === "Page.frameNavigated" || method === "Runtime.executionContextsCleared") {
		state.contextId = undefined;
		state.frameId = undefined;
		state.revision = undefined;
	}
	if (method === "Inspector.detached") {
		state.attached = false;
		state.contextId = undefined;
		state.cancelled = true;
	}
});

chrome.debugger.onDetach.addListener((source) => {
	if (source.tabId === undefined) return;
	const state = tabsOwned.get(source.tabId);
	if (state) {
		state.attached = false;
		state.contextId = undefined;
		state.cancelled = true;
	}
});

chrome.tabs.onRemoved.addListener((tabId) => {
	const state = tabsOwned.get(tabId);
	if (state) {
		state.cancelled = true;
		tabsOwned.delete(tabId);
	}
});

chrome.windows.onRemoved.addListener((windowId) => {
	if (windowId === agentWindowId) agentWindowId = undefined;
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
	if (windowId !== agentWindowId) return;
	const window = await chrome.windows.get(windowId);
	if (!window.focused) return;
	pausedByUser = true;
	await chrome.storage.local.set({ pausedByUser: true });
	stopLocally();
	send({ event: "stop" });
});

chrome.windows.onBoundsChanged.addListener(async (window) => {
	if (window.id !== agentWindowId || window.state === "minimized") return;
	const current = await chrome.windows.get(window.id);
	if (current.state === "minimized" && !current.focused) return;
	pausedByUser = true;
	await chrome.storage.local.set({ pausedByUser: true });
	stopLocally();
	send({ event: "stop" });
});

chrome.tabs.onAttached.addListener((tabId, info) => {
	const state = tabsOwned.get(tabId);
	if (!state || info.newWindowId === state.windowId) return;
	pausedByUser = true;
	chrome.storage.local.set({ pausedByUser: true });
	stopLocally();
	send({ event: "stop" });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (changeInfo.status !== "loading") return;
	const state = tabsOwned.get(tabId);
	if (state) {
		state.contextId = undefined;
		state.frameId = undefined;
		state.revision = undefined;
	}
});

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
	if (message?.type === "connect-local") {
		localConnection()
			.then(async (connection) => {
				await chrome.storage.local.set({ ...connection, pausedByUser: false });
				pausedByUser = false;
				if (socket) {
					reconnectRequested = true;
					socket.close();
				} else await connect();
				respond({ ok: true });
			})
			.catch((error) =>
				respond({ ok: false, error: error instanceof Error ? error.message : "Local pairing failed" }),
			);
		return true;
	}
	if (message?.type === "stop") {
		pausedByUser = true;
		void chrome.storage.local.set({ pausedByUser: true });
		stopLocally();
		send({ event: "stop" });
		respond({ ok: true });
	}
	if (message?.type === "connect") {
		chrome.storage.local.set({ pausedByUser: false }).then(() => {
			pausedByUser = false;
			if (socket) {
				reconnectRequested = true;
				socket.close();
			} else void connect();
		});
		respond({ ok: true });
	}
});

chrome.storage.onChanged.addListener((changes, area) => {
	if (area === "local" && ("port" in changes || "token" in changes)) {
		reconnectRequested = true;
		if (socket) socket.close();
		ready = false;
		stopLocally();
		if (!socket) void connect();
	}
});

chrome.alarms.create("browser-bridge-connect", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name !== "browser-bridge-connect") return;
	if (socket?.readyState === WebSocket.OPEN && ready) send({ event: "heartbeat" });
	else void connect();
});

void connect();
