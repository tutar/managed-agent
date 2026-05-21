#!/usr/bin/env node
/**
 * CLI adapter for the harness.
 * Usage: harness --input "hello" --model deepseek/deepseek-v4-pro
 */

import { resolveAdapter } from "./adapter.js";

const args = process.argv.slice(2);
const prompt = args.find((a) => a.startsWith("--input="))?.split("=")[1] ?? args[0] ?? "";
const model = args.find((a) => a.startsWith("--model="))?.split("=")[1] ?? "deepseek/deepseek-v4-pro";
const thinkingLevel = args.find((a) => a.startsWith("--thinking="))?.split("=")[1] ?? "high";

const adapter = await resolveAdapter();
for await (const event of adapter.run({ model, thinkingLevel, prompt })) {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}
