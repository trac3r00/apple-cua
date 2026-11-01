// Node's type-stripping runner does not remap emitted `.js` specifiers to TypeScript source.
// Package builds emit dist/history-demonstration.js directly from history-demonstration.ts.
export * from "./history-demonstration.ts";
