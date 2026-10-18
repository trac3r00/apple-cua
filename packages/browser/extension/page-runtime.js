export function pageRuntime(input) {
	const stateKey = "__appleCuaPageRuntimeState";
	let state = globalThis[stateKey];
	if (!state || state.document !== document) {
		state = {
			document,
			url: location.href,
			prefix: Math.random().toString(36).slice(2, 10),
			nextRef: 1,
			generation: 0,
			refs: new Map(),
			elementRefs: new WeakMap(),
			observer: null,
		};
		state.observer = new MutationObserver(() => {
			state.generation += 1;
		});
		state.observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
		globalThis[stateKey] = state;
	}

	const visible = (element) => {
		if (!element.isConnected || element.getAttribute("hidden") !== null) return false;
		const style = getComputedStyle(element);
		if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	};
	const editable = (element) => {
		if (element instanceof HTMLInputElement) {
			if (element.readOnly) return false;
			return ![
				"button",
				"checkbox",
				"color",
				"file",
				"hidden",
				"image",
				"password",
				"radio",
				"reset",
				"submit",
			].includes(element.type);
		}
		return (element instanceof HTMLTextAreaElement && !element.readOnly) || element.isContentEditable;
	};
	const redactControl = (element) =>
		element instanceof HTMLInputElement && ["password", "hidden"].includes(element.type);
	const roleFor = (element) => {
		const explicit = element.getAttribute("role");
		if (explicit) return explicit.slice(0, 60);
		const tag = element.tagName.toLowerCase();
		if (/^h[1-6]$/.test(tag)) return "heading";
		if (tag === "button" || (tag === "input" && ["button", "submit", "reset"].includes(element.type)))
			return "button";
		if (tag === "a" && element.hasAttribute("href")) return "link";
		if (tag === "select") return "combobox";
		if (tag === "textarea") return "textbox";
		if (tag === "input" && ["checkbox", "radio"].includes(element.type)) return element.type;
		if (tag === "input") return editable(element) ? "textbox" : "";
		if (element.isContentEditable) return "textbox";
		if (tag === "p") return "paragraph";
		if (tag === "progress") return "progressbar";
		if (tag === "output" || element.getAttribute("aria-live")) return "status";
		return "";
	};
	const nameFor = (element) => {
		if (redactControl(element)) return "[redacted]";
		const label =
			element.getAttribute("aria-label") ||
			element.labels?.[0]?.innerText ||
			(!editable(element) && element.innerText) ||
			element.getAttribute("alt") ||
			element.getAttribute("title") ||
			"";
		return label.replace(/\s+/g, " ").trim().slice(0, 500);
	};
	const fail = (message) => ({ error: message });
	const checkRevision = (revision) => {
		if (state.url !== location.href) return false;
		if (state.document !== document || revision !== `${state.prefix}:${state.generation}`) return false;
		return true;
	};
	const resolve = (revision, ref) => {
		if (!checkRevision(revision)) return { error: "stale" };
		const element = state.refs.get(ref);
		if (!element || !element.isConnected || !visible(element)) return { error: "target unavailable" };
		if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true")
			return { error: "target disabled" };
		return { element };
	};

	if (input.method === "observe") {
		const limits = input.limits || {};
		const maxChars = limits.maxChars ?? 6000;
		const maxElements = limits.maxElements ?? 80;
		const fullPage = limits.fullPage ?? false;
		const rows = [];
		let chars = 0;
		let visited = 0;
		let truncated = false;
		state.refs = new Map();
		if (state.url !== location.href) {
			state.generation++;
			state.url = location.href;
		}
		const inViewport = (element) => {
			if (fullPage) return true;
			const rect = element.getBoundingClientRect();
			return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
		};
		const visit = (root) => {
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
			for (let element = walker.nextNode(); element; element = walker.nextNode()) {
				visited++;
				if (rows.length >= maxElements || chars >= maxChars || visited > 10000) {
					truncated = true;
					return;
				}
				if (!visible(element) || !inViewport(element)) continue;
				const role = roleFor(element);
				if (role) {
					const name = nameFor(element);
					if (name) {
						let ref = state.elementRefs.get(element);
						if (ref === undefined) {
							ref = state.nextRef++;
							state.elementRefs.set(element, ref);
						}
						const row = { ref, role, name };
						const size = JSON.stringify(row).length;
						if (chars + size > maxChars) {
							truncated = true;
							return;
						}
						state.refs.set(ref, element);
						rows.push(row);
						chars += size;
					}
				}
				if (element.shadowRoot) {
					state.observer.observe(element.shadowRoot, {
						subtree: true,
						childList: true,
						attributes: true,
						characterData: true,
					});
					visit(element.shadowRoot);
				}
			}
		};
		visit(document);
		return {
			url: `${location.origin}${location.pathname}`,
			title: document.title.slice(0, 500),
			revision: `${state.prefix}:${state.generation}`,
			rows,
			truncated,
		};
	}

	if (input.method === "target" || input.method === "focus") {
		const result = resolve(input.revision, input.ref);
		if (result.error) return fail(result.error);
		const element = result.element;
		if (input.method === "focus") {
			if (redactControl(element)) return fail("sensitive control");
			element.focus();
			if (input.selectAll) {
				state.fillTarget = element;
				state.fillText = input.text;
				if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.select();
				else if (element.isContentEditable) {
					const range = document.createRange();
					range.selectNodeContents(element);
					const selection = getSelection();
					selection.removeAllRanges();
					selection.addRange(range);
				}
				state.fillWait = new Promise((resolveFill) => {
					const matches = () => (element.isContentEditable ? element.textContent : element.value) === input.text;
					const changed = () => {
						if (matches()) finish(true);
					};
					const finish = (ok) => {
						element.removeEventListener("input", changed);
						clearTimeout(timer);
						resolveFill(ok ? { ok: true } : fail("filled value did not match"));
					};
					element.addEventListener("input", changed);
					const timer = setTimeout(() => finish(false), 3000);
				});
			}
			return { ok: true, editable: editable(element) };
		}
		element.scrollIntoView({ block: "center", inline: "center" });
		const rect = element.getBoundingClientRect();
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return fail("target center outside viewport");
		let hit = document.elementFromPoint(x, y);
		while (hit?.shadowRoot) {
			const inner = hit.shadowRoot.elementFromPoint(x, y);
			if (!inner || inner === hit) break;
			hit = inner;
		}
		if (!hit || !(hit === element || element.contains(hit))) {
			return fail("target center is obscured");
		}
		return { x, y, editable: editable(element) };
	}

	if (input.method === "fillComplete") {
		const element = state.fillTarget;
		if (element && (element.isContentEditable ? element.textContent : element.value) === state.fillText)
			return { ok: true };
		return state.fillWait ?? fail("no fill is pending");
	}

	if (input.method === "prepareScroll") {
		const scroller = document.scrollingElement;
		if (!scroller) return fail("no scroll container");
		const before = scroller.scrollTop;
		const next = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, before + input.deltaY));
		if (next === before) {
			state.scrollWait = Promise.resolve({ ok: true });
			return { ok: true, needed: false };
		}
		state.scrollWait = new Promise((resolveScroll) => {
			const ended = () => finish(scroller.scrollTop !== before);
			const finish = (ok) => {
				document.removeEventListener("scrollend", ended);
				clearTimeout(timer);
				resolveScroll(ok ? { ok: true } : fail("scroll did not move the document"));
			};
			document.addEventListener("scrollend", ended);
			const timer = setTimeout(() => finish(false), 3000);
		});
		return { ok: true, needed: true };
	}

	if (input.method === "scrollComplete") {
		return state.scrollWait ?? fail("no scroll is pending");
	}

	if (input.method === "verify") {
		const text = input.text;
		const timeoutMs = input.timeoutMs ?? 3000;
		const contains = () => document.body?.innerText.includes(text) ?? false;
		if (contains()) return { ok: true };
		return new Promise((resolvePromise) => {
			const observer = new MutationObserver(() => {
				if (contains()) finish(true);
			});
			const finish = (ok) => {
				observer.disconnect();
				clearTimeout(timer);
				resolvePromise(ok ? { ok: true } : { error: "timeout" });
			};
			observer.observe(document, { subtree: true, childList: true, characterData: true });
			const timer = setTimeout(() => finish(false), timeoutMs);
			if (contains()) finish(true);
		});
	}
	return fail("unsupported method");
}
