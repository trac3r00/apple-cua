// Node's type-stripping runner does not remap emitted `.js` specifiers to TypeScript source.
// Package builds emit dist/history-suggest.js directly from history-suggest.ts.
export * from "./history-suggest.ts";
