import { createServer } from "node:http";
import { PAGE_HEADING } from "./fixture.mjs";

const page = `<!doctype html><html><head><title>${PAGE_HEADING}</title></head><body><h1>${PAGE_HEADING}</h1><label>Code <input id="code"></label><a href="#destination" id="link">Destination</a><h2 id="destination">Destination reached</h2><script>
const nonce = crypto.randomUUID();
const report = () => fetch('/state', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({page:location.href, nonce, field:document.querySelector('#code').value, hash:location.hash, heading:document.querySelector('h1').innerText})});
addEventListener('load', report);
addEventListener('hashchange', report);
document.querySelector('#code').addEventListener('input', report);
document.querySelector('#code').addEventListener('change', report);
</script></body></html>`;

export async function startOracleServer() {
	let state = null;
	const listeners = new Set();
	const server = createServer((request, response) => {
		if (new URL(request.url, "http://127.0.0.1").pathname === "/page" && request.method === "GET") {
			response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
			response.end(page);
			return;
		}
		if (request.url !== "/state" || request.method !== "POST") {
			response.writeHead(404).end();
			return;
		}
		let body = "";
		request.on("data", (chunk) => {
			body += chunk;
			if (body.length > 4096) request.destroy();
		});
		request.on("end", () => {
			try {
				const value = JSON.parse(body);
				if (
					typeof value.page !== "string" ||
					typeof value.nonce !== "string" ||
					typeof value.field !== "string" ||
					typeof value.hash !== "string" ||
					typeof value.heading !== "string"
				)
					throw new Error("invalid page report");
				state = value;
				for (const listener of listeners) listener();
				response.writeHead(204).end();
			} catch {
				response.writeHead(400).end();
			}
		});
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("oracle server has no port");
	const url = `http://127.0.0.1:${address.port}/page`;
	return {
		url,
		get state() {
			return state;
		},
		async waitFor(predicate, timeoutMs = 2000) {
			if (predicate(state)) return true;
			return new Promise((resolve) => {
				const done = () => {
					if (!predicate(state)) return;
					clearTimeout(timer);
					listeners.delete(done);
					resolve(true);
				};
				const timer = setTimeout(() => {
					listeners.delete(done);
					resolve(false);
				}, timeoutMs);
				listeners.add(done);
			});
		},
		close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
	};
}

export function safariMatches(kind, expected, state, baselineNonce) {
	if (!state || typeof state.nonce !== "string") return false;
	switch (kind) {
		case "safari-heading":
			return state.nonce !== baselineNonce && state.heading === PAGE_HEADING;
		case "safari-field":
			return state.field === expected;
		case "safari-link":
			return state.hash === "#destination";
		default:
			throw new Error(`unknown Safari oracle: ${kind}`);
	}
}
