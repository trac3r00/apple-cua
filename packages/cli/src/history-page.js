// Node's type-stripping runner does not remap emitted `.js` specifiers to TypeScript source.
// Package builds emit dist/history-page.js directly from history-page.ts.
export * from "./history-page.ts";
