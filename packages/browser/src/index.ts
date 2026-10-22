export { BrowserBridge, type BrowserTransport } from "./bridge.js";
export { BrowserSession } from "./session.js";
export { BrowserController } from "./controller.js";
export { BrowserError } from "./protocol.js";
export {
	BROWSER_TOOL_NAMES,
	type BrowserControllerLike,
	createBrowserMcpServer,
	main as runBrowserMcpServer,
	registerBrowserTools,
} from "./server.js";
export { connectBrowserController, RemoteBrowserController } from "./remote.js";
export { readConnection } from "./connection.js";
export {
	doctorBrowserService,
	EXTENSION_ID,
	installBrowserService,
	uninstallBrowserService,
} from "./service.js";
export type { BrowserCommand, BrowserObservation, BrowserStep } from "./protocol.js";
