// Node's type-stripping runner does not remap emitted .js specifiers to TypeScript source.
// Package builds emit dist/platform-onboarding.js directly from platform-onboarding.ts.
export * from "./platform-onboarding.ts";
