// Appends today's closed-day verdicts to ledger.json. Run daily by .github/workflows/record.yml.
// First run: node record.mjs --replay 90 (backfills the last 90 closed days as "replay" entries).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { run } from "./desk.js";
import { verifyChain } from "./agents.js";
import { readVoices } from "./narrative.js";

const i = process.argv.indexOf("--replay");
const replay = i > 0 ? +process.argv[i + 1] : 0;
const ledger = existsSync("ledger.json") ? JSON.parse(readFileSync("ledger.json", "utf8")) : [];
// The Multi-KOL agent runs on its own here: read the voices in kol.json; a converged narrative joins today's debate.
// If Telegram is unreachable the day is still recorded, without a narrative, and the log says so.
const voices = replay ? null : await readVoices(JSON.parse(readFileSync("kol.json", "utf8"))).catch(e => ({ error: String(e.message || e), kol: {} }));
const out = await run(ledger, replay, voices?.kol ?? {});
const check = await verifyChain(ledger);
if (!check.ok) throw new Error(`chain broken: ${JSON.stringify(check)}`);
writeFileSync("ledger.json", JSON.stringify(ledger, null, 1) + "\n");
const kol = voices && { sources: voices.sources, error: voices.error, converged: Object.values(voices.kol).map(k => `${k.token} ${k.side} ${k.bull || k.bear}/${k.voices}`) };
console.log(JSON.stringify({ ...out, head: check.head, kol }));
