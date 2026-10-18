const form = document.querySelector("#settings");
const portInput = document.querySelector("#port");
const tokenInput = document.querySelector("#token");
const status = document.querySelector("#status");

function renderConnection(state) {
	status.dataset.state = state.bridgePausedByUser
		? "paused"
		: !state.bridgeConnected
			? "disconnected"
			: state.bridgeStopped
				? "stopped"
				: "connected";
	document.querySelector("#connect-local").disabled =
		state.bridgeConnected && !state.bridgeStopped && !state.bridgePausedByUser;
	status.textContent = state.bridgePausedByUser
		? "Actions paused. Connect the local service or save manual settings to resume."
		: !state.bridgeConnected
			? "Disconnected. Start the local service or check manual connection settings."
			: state.bridgeStopped
				? "Actions stopped. Reconnect when ready."
				: "Connected to apple-cua.";
}

const connectionKeys = ["bridgeConnected", "bridgeStopped", "bridgePausedByUser"];
chrome.storage.session.get(connectionKeys, renderConnection);
chrome.storage.onChanged.addListener((_changes, area) => {
	if (area === "session") chrome.storage.session.get(connectionKeys, renderConnection);
});

chrome.storage.local.get(["port", "token"], (settings) => {
	if (Number.isInteger(settings.port)) portInput.value = String(settings.port);
	if (typeof settings.token === "string") tokenInput.value = settings.token;
});

form.addEventListener("submit", (event) => {
	event.preventDefault();
	const port = Number(portInput.value);
	const token = tokenInput.value.trim();
	if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[0-9a-f]{64}$/i.test(token)) {
		status.dataset.state = "error";
		status.textContent = "Enter a valid port and a 64-character hexadecimal token.";
		return;
	}
	chrome.storage.local.set({ port, token }, () => {
		status.dataset.state = chrome.runtime.lastError ? "error" : "connecting";
		status.textContent = chrome.runtime.lastError?.message ?? "Saved. Connecting…";
		chrome.runtime.sendMessage({ type: "connect" });
	});
});

document.querySelector("#stop").addEventListener("click", () => {
	chrome.runtime.sendMessage({ type: "stop" }, (response) => {
		status.dataset.state = response?.ok ? "paused" : "error";
		status.textContent = response?.ok ? "Stopped until a fresh connection." : "Unable to stop actions.";
	});
});

document.querySelector("#connect-local").addEventListener("click", () => {
	status.dataset.state = "connecting";
	status.textContent = "Connecting to the local service…";
	chrome.runtime.sendMessage({ type: "connect-local" }, (response) => {
		if (!response?.ok) {
			status.dataset.state = "error";
			status.textContent = response?.error ?? chrome.runtime.lastError?.message ?? "Local pairing failed.";
		}
	});
});
