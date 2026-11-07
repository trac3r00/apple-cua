// Node's type-stripping runner does not remap emitted .js specifiers to TypeScript source.
// Package builds emit dist/json-config-edit.js directly from json-config-edit.ts.
export * from "./json-config-edit.ts";
