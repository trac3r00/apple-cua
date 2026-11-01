// Node's type-stripping runner does not remap emitted `.js` specifiers to TypeScript source.
// Package builds emit dist/history-service.js directly from history-service.ts.
export * from "./history-service.ts";
