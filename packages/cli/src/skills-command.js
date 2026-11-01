// Node's type-stripping runner does not remap emitted `.js` specifiers to TypeScript source.
// Package builds emit dist/skills-command.js directly from skills-command.ts.
export * from "./skills-command.ts";
