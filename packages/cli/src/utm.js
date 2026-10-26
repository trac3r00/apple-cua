// Node's type-stripping runner does not remap emitted `.js` specifiers to TypeScript source.
// Package builds emit dist/utm.js directly from utm.ts.
export * from "./utm.ts";
