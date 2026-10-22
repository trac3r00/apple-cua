const status = document.querySelector("#status");
const handoff = document.querySelector("#handoff");
const keys = ["bridgeConnected", "bridgeStopped", "bridgePausedByUser", "handoffRequest"];

function render(state) {
	status.textContent = !state.bridgeConnected
		? "Disconnected"
		: state.bridgePausedByUser
			? "You have control"
			: state.bridgeStopped
				? "Stopped"
				: "Agent working";
	handoff.textContent = state.handoffRequest?.reason ? `Agent asks: ${state.handoffRequest.reason}` : "";
}

chrome.storage.session.get(keys, render);
chrome.storage.onChanged.addListener((_changes, area) => {
	if (area === "session") chrome.storage.session.get(keys, render);
});

for (const type of ["take-over", "give-back", "stop"]) {
	document.querySelector(`#${type}`).addEventListener("click", () => {
		chrome.runtime.sendMessage({ type }, (response) => {
			if (response?.ok) return;
			status.textContent = response?.error ?? "Unable to change control.";
		});
	});
}
