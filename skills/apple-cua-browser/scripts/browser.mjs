#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root =
	process.env.APPLE_CUA_BROWSER_ROOT ?? resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), "../../..");
const entry = resolve(root, "packages/browser/dist/cli.js");
const { cliMain } = await import(pathToFileURL(entry).href);
await cliMain(process.argv.slice(2));
