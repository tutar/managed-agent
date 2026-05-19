#!/usr/bin/env node
/**
 * CLI adapter for the pi harness.
 * Usage: harness --input "hello" --model deepseek/deepseek-v4-pro
 */

import { runHarness } from "./executor.js";

const args = process.argv.slice(2);
const prompt = args.find((a) => a.startsWith("--input="))?.split("=")[1] ?? args[0] ?? "";
const model = args.find((a) => a.startsWith("--model="))?.split("=")[1] ?? "deepseek/deepseek-v4-pro";
const thinkingLevel = args.find((a) => a.startsWith("--thinking="))?.split("=")[1] ?? "high";

for await (const event of runHarness({ model, thinkingLevel, prompt })) {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}
