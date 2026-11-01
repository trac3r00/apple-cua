// Node's type-stripping runner does not remap emitted `.js` specifiers to TypeScript source.
// Package builds emit dist/history-agent.js directly from history-agent.ts.
export * from "./history-agent.ts";
