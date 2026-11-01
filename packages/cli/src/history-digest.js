// Node's type-stripping runner does not remap emitted `.js` specifiers to TypeScript source.
// Package builds emit dist/history-digest.js directly from history-digest.ts.
export * from "./history-digest.ts";
