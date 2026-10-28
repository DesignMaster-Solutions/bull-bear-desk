// Appends today's closed-day verdicts to ledger.json. Run daily by .github/workflows/record.yml.
// First run: node record.mjs --replay 90 (backfills the last 90 closed days as "replay" entries).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { run } from "./desk.js";
import { verifyChain } from "./agents.js";

const i = process.argv.indexOf("--replay");
const ledger = existsSync("ledger.json") ? JSON.parse(readFileSync("ledger.json", "utf8")) : [];
const out = await run(ledger, i > 0 ? +process.argv[i + 1] : 0);
const check = await verifyChain(ledger);
if (!check.ok) throw new Error(`chain broken: ${JSON.stringify(check)}`);
writeFileSync("ledger.json", JSON.stringify(ledger, null, 1) + "\n");
console.log(JSON.stringify({ ...out, head: check.head }));
