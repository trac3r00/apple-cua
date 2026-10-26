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
			cache: undefined,
			fillTarget: undefined,
			fillText: undefined,
			fillWait: undefined,
			scrollWait: undefined,
		};
		state.observer = new MutationObserver(() => {
			state.generation += 1;
			state.cache = undefined;
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
				"range",
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
		if (tag === "p" || tag === "li") return tag === "p" ? "paragraph" : "listitem";
		if (tag === "progress") return "progressbar";
		if (tag === "output" || element.getAttribute("aria-live")) return "status";
		return "";
	};
	const contentRole = (role) => role === "heading" || role === "paragraph" || role === "listitem";
	const included = (role, profile) => {
		if (profile === "content") return contentRole(role);
		return role !== "";
	};
	const nameFor = (element, maxNameChars, allowText) => {
		if (redactControl(element)) return "[redacted]";
		const label =
			element.getAttribute("aria-label") ||
			element.labels?.[0]?.innerText ||
			element.getAttribute("alt") ||
			element.getAttribute("title") ||
			element.getAttribute("placeholder") ||
			"";
		const text = label || (allowText ? element.innerText || element.textContent || "" : "");
		return text.replace(/\s+/g, " ").trim().slice(0, maxNameChars);
	};
	const fail = (message) => ({ error: message });
	const revision = () => `${state.prefix}:${state.generation}`;
	const checkRevision = (expected) => {
		if (state.url !== location.href) return false;
		if (state.document !== document || expected !== revision()) return false;
		return true;
	};
	const refFor = (element) => {
		let ref = state.elementRefs.get(element);
		if (ref === undefined) {
			ref = state.nextRef++;
			state.elementRefs.set(element, ref);
		}
		return ref;
	};
	const resolve = (expected, ref, allowStaleRevision = false) => {
		if (allowStaleRevision) {
			if (state.url !== location.href || state.document !== document) return { error: "stale" };
		} else if (!checkRevision(expected)) return { error: "stale" };
		const element = state.refs.get(ref);
		if (!element || !element.isConnected || !visible(element)) return { error: "target unavailable" };
		if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true")
			return { error: "target disabled" };
		return { element };
	};
	const inViewport = (element, fullPage) => {
		if (fullPage) return true;
		const rect = element.getBoundingClientRect();
		return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
	};
	const visit = (root, callback) => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
		let visited = 0;
		for (let element = walker.nextNode(); element; element = walker.nextNode()) {
			visited++;
			if (visited > 20000) return false;
			if (!callback(element)) return true;
			if (element.shadowRoot) {
				state.observer.observe(element.shadowRoot, {
					subtree: true,
					childList: true,
					attributes: true,
					characterData: true,
				});
				if (visit(element.shadowRoot, callback) === false) return false;
			}
		}
		return true;
	};
	const matchesQuery = (role, name, element, query) => {
		if (query.role !== undefined && role.toLowerCase() !== query.role.toLowerCase()) return false;
		if (query.name !== undefined && !name.toLowerCase().includes(query.name.toLowerCase())) return false;
		if (query.text !== undefined) {
			const text = `${name} ${element.innerText || element.textContent || ""}`.toLowerCase().replace(/\s+/g, " ");
			if (!text.includes(query.text.toLowerCase().replace(/\s+/g, " "))) return false;
		}
		return true;
	};
	const interactiveRoles = new Set([
		"button",
		"link",
		"textbox",
		"combobox",
		"checkbox",
		"radio",
		"switch",
		"tab",
		"menuitem",
		"option",
		"searchbox",
	]);
	const scoreMatch = (role, name, element, query) => {
		let score = 0;
		if (query.role !== undefined) score += 40;
		if (query.name !== undefined) {
			const needle = query.name.toLowerCase();
			const haystack = name.toLowerCase();
			const index = haystack.indexOf(needle);
			if (index === 0) score += haystack.length === needle.length ? 120 : 70;
			else if (index > 0) score += 20;
			if (index === 0 || /(^|[^a-z0-9])$/.test(haystack.slice(0, Math.max(index, 0)))) score += 15;
		}
		if (query.text !== undefined) score += 10;
		if (interactiveRoles.has(role)) score += 20;
		if (element.matches?.(":disabled")) score -= 40;
		return score;
	};
	const collectMatches = (query, limit, fullPage) => {
		const found = [];
		let order = 0;
		visit(document, (element) => {
			const role = roleFor(element);
			if (role === "" || !visible(element) || !inViewport(element, fullPage)) return true;
			const name = nameFor(element, 500, true);
			if (!name || !matchesQuery(role, name, element, query)) return true;
			const nested = found.some(
				(match) =>
					match.role === role &&
					match.name === name &&
					(match.element.contains(element) || element.contains(match.element)),
			);
			if (nested) return true;
			const ref = refFor(element);
			state.refs.set(ref, element);
			found.push({ element, ref, role, name, score: scoreMatch(role, name, element, query), order: order++ });
			return true;
		});
		found.sort((left, right) => right.score - left.score || left.order - right.order);
		return { matches: found.slice(0, limit), total: found.length };
	};
	const resolveInput = (input) => {
		if (input.query === undefined) return resolve(input.revision, input.ref, input.allowStaleRevision === true);
		const best = collectMatches(input.query, 1, true).matches[0];
		if (best === undefined) return { error: "no visible target matches the query" };
		return { element: best.element, ref: best.ref };
	};
	const isSelectElement = (element) =>
		String(element?.tagName).toLowerCase() === "select" && element?.options !== undefined;
	const optionLabel = (option) =>
		String(option.label ?? option.textContent ?? "")
			.replace(/\s+/g, " ")
			.trim();
	const notifyChange = (element, type) => {
		const view = element.ownerDocument?.defaultView;
		const EventConstructor = view?.Event ?? globalThis.Event;
		if (typeof EventConstructor !== "function") return;
		element.dispatchEvent(new EventConstructor(type, { bubbles: true }));
	};
	const settle = (maxMs) =>
		new Promise((resolveSettle) => {
			let quiet;
			const finish = () => {
				observer.disconnect();
				clearTimeout(quiet);
				clearTimeout(deadline);
				resolveSettle();
			};
			const observer = new MutationObserver(() => {
				clearTimeout(quiet);
				quiet = setTimeout(finish, 24);
			});
			observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
			quiet = setTimeout(finish, 24);
			const deadline = setTimeout(finish, maxMs);
		});

	if (input.method === "revision") return revision();

	if (input.method === "observe") {
		const limits = input.limits || {};
		const maxChars = limits.maxChars ?? 6000;
		const maxElements = limits.maxElements ?? 80;
		const maxNameChars = limits.maxNameChars ?? 120;
		const fullPage = limits.fullPage ?? false;
		const profile = limits.profile ?? "interactive";
		const query = limits.query;
		const key = JSON.stringify([revision(), maxChars, maxElements, maxNameChars, fullPage, profile, query]);
		if (state.cache?.key === key) return { ...state.cache.result, cached: true };
		if (state.url !== location.href) {
			state.generation++;
			state.url = location.href;
		}
		const rows = [];
		let chars = 0;
		let truncated = false;
		state.refs = new Map();
		visit(document, (element) => {
			const role = roleFor(element);
			if (role === "" || !included(role, profile) || !inViewport(element, fullPage) || !visible(element))
				return true;
			const name = nameFor(
				element,
				profile === "interactive" && contentRole(role) ? Math.min(maxNameChars, 160) : maxNameChars,
				contentRole(role) || role === "button" || role === "link" || role === "status",
			);
			if (
				!name ||
				(query !== undefined &&
					!matchesQuery(role, name, element, { role: undefined, name: query, text: undefined }))
			)
				return true;
			const row = { ref: refFor(element), role, name };
			const size = JSON.stringify(row).length;
			if (rows.length >= maxElements || chars + size > maxChars) {
				truncated = true;
				return false;
			}
			state.refs.set(row.ref, element);
			rows.push(row);
			chars += size;
			return true;
		});
		const result = {
			url: `${location.origin}${location.pathname}`.slice(0, 8192),
			title: document.title.slice(0, 500),
			revision: revision(),
			rows,
			truncated,
		};
		state.cache = { key, result };
		return result;
	}

	if (input.method === "find") {
		const limit = input.limit ?? 10;
		const found = collectMatches(input.query || {}, limit, false);
		return {
			url: `${location.origin}${location.pathname}`.slice(0, 8192),
			title: document.title.slice(0, 500),
			revision: revision(),
			matches: found.matches.map(({ ref, role, name }) => ({ ref, role, name })),
			truncated: found.total > limit,
		};
	}

	if (input.method === "read") {
		const maxChars = input.maxChars ?? 8000;
		const root = document.querySelector("main, article, [role=main]") || document.body;
		const raw = root ? root.innerText || root.textContent || "" : "";
		const text = raw
			.replace(/[ \t]+/g, " ")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
		const links = [];
		if (input.includeLinks) {
			for (const element of document.querySelectorAll("a[href]")) {
				if (!visible(element) || !inViewport(element, true)) continue;
				const name = nameFor(element, 200, true);
				if (!name) continue;
				const ref = refFor(element);
				state.refs.set(ref, element);
				links.push({ ref, name });
				if (links.length >= 100) break;
			}
		}
		return {
			url: `${location.origin}${location.pathname}`.slice(0, 8192),
			title: document.title.slice(0, 500),
			revision: revision(),
			text: text.slice(0, maxChars),
			...(input.includeLinks ? { links } : {}),
			truncated: text.length > maxChars,
		};
	}

	if (input.method === "wait") {
		const timeoutMs = input.timeoutMs ?? 3000;
		const text = input.text;
		const selector = input.selector;
		const observeRoots = () => {
			const roots = [document];
			for (const root of roots) {
				for (const element of root.querySelectorAll("*")) {
					if (element.shadowRoot) roots.push(element.shadowRoot);
				}
			}
			return roots;
		};
		const textPresent = () => {
			if (text === undefined) return true;
			return observeRoots().some((root) =>
				root === document
					? document.body?.innerText.includes(text)
					: Array.from(root.children).some((element) => element.innerText?.includes(text)),
			);
		};
		const selectorPresent = () => {
			if (selector === undefined) return true;
			if (document.querySelector(selector) !== null) return true;
			return observeRoots().some((root) => root !== document && root.querySelector(selector) !== null);
		};
		const ready = () => textPresent() && selectorPresent();
		if (ready()) return { matched: true, reason: "matched", revision: revision() };
		return new Promise((resolveWait) => {
			const observer = new MutationObserver(() => {
				if (ready()) finish(true);
			});
			const finish = (matched) => {
				observer.disconnect();
				clearTimeout(timer);
				resolveWait({ matched, reason: matched ? "matched" : "timeout", revision: revision() });
			};
			for (const root of observeRoots()) {
				observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
			}
			const timer = setTimeout(() => finish(false), timeoutMs);
			observer.takeRecords();
		});
	}

	if (input.method === "resolveTarget") {
		const best = collectMatches(input.query || {}, 1, true).matches[0];
		if (best === undefined) return fail("no visible target matches the query");
		return { ok: true, ref: best.ref, role: best.role, name: best.name };
	}

	if (input.method === "selectOption") {
		state.cache = undefined;
		const resolved = resolveInput(input);
		if (resolved.error) return fail(resolved.error);
		const element = resolved.element;
		if (!isSelectElement(element)) return fail("target is not a select control");
		const choice = input.choice || {};
		const options = Array.from(element.options || []);
		let option;
		if (choice.index !== undefined) option = options[choice.index];
		else if (choice.value !== undefined) option = options.find((item) => item.value === choice.value);
		else if (choice.label !== undefined) {
			const wanted = String(choice.label).replace(/\s+/g, " ").trim().toLowerCase();
			const exact = options.filter((item) => optionLabel(item).toLowerCase() === wanted);
			option = exact.length === 1 ? exact[0] : undefined;
			if (option === undefined) {
				const partial = options.filter((item) => optionLabel(item).toLowerCase().includes(wanted));
				option = partial.length === 1 ? partial[0] : undefined;
			}
		}
		if (option === undefined) return fail("requested option was not found");
		if (option.disabled) return fail("requested option is disabled");
		element.value = option.value;
		notifyChange(element, "input");
		notifyChange(element, "change");
		if (element.value !== option.value) return fail("select control did not accept the option");
		if (element.selectedIndex !== undefined && element.selectedIndex !== options.indexOf(option))
			return fail("select control did not accept the option");
		state.cache = undefined;
		return { ok: true, value: option.value, label: optionLabel(option) };
	}

	if (input.method === "target" || input.method === "focus" || input.method === "prepareFill") {
		state.cache = undefined;
		const result = resolveInput(input);
		if (result.error) return fail(result.error);
		const element = result.element;
		if (input.method === "prepareFill") {
			if (!editable(element) || redactControl(element)) return fail("target is not a permitted editable field");
		}
		if (input.method === "focus" || input.method === "prepareFill") {
			if (redactControl(element)) return fail("sensitive control");
			element.focus();
			if (input.selectAll || input.method === "prepareFill") {
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
					const matches = () =>
						visible(element) && (element.isContentEditable ? element.textContent : element.value) === input.text;
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
			if (hit === element || element.contains(hit)) break;
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
		if (element && !visible(element)) return fail("fill target unavailable");
		if (element && (element.isContentEditable ? element.textContent : element.value) === state.fillText)
			return settle(150).then(() => ({ ok: true }));
		return state.fillWait ?? fail("no fill is pending");
	}

	if (input.method === "prepareScroll") {
		state.cache = undefined;
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
		const roots = () => {
			const found = [document];
			for (const root of found) {
				for (const element of root.querySelectorAll("*")) {
					if (element.shadowRoot) found.push(element.shadowRoot);
				}
			}
			return found;
		};
		const contains = (current) =>
			current.some((root) =>
				root === document
					? document.body?.innerText.includes(text)
					: Array.from(root.children).some((element) => element.innerText?.includes(text)),
			);
		if (contains(roots())) return { ok: true };
		return new Promise((resolvePromise) => {
			const observer = new MutationObserver(() => check());
			const check = () => {
				const current = roots();
				for (const root of current) {
					observer.observe(root, { subtree: true, childList: true, characterData: true });
				}
				if (contains(current)) finish(true);
			};
			const finish = (ok) => {
				observer.disconnect();
				clearTimeout(timer);
				resolvePromise(ok ? { ok: true } : { error: "timeout" });
			};
			const timer = setTimeout(() => finish(false), timeoutMs);
			check();
		});
	}
	return fail("unsupported method");
}
