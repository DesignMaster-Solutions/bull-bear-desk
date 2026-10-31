import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../desk.js";
import { verifyChain } from "../agents.js";
import { readVoices } from "../narrative.js";

// Synthetic Kraken rows (62 closed days, a week old) and an empty Fear & Greed answer.
const day = 86400;
const t0 = Math.floor(Date.now() / 1000 / day) * day - 70 * day;
const rows = Array.from({ length: 62 }, (_, i) => { const c = 100 + i; return [t0 + i * day, c, c * 1.01, c * 0.99, c, c, 100, 1]; });
const fakeFetch = async url => ({ ok: true, json: async () => url.includes("kraken") ? { error: [], result: { X: rows, last: 0 } } : { data: [] } });
const page = text => `<div class="tgme_widget_message_text">${text}</div></div><time datetime="${new Date().toISOString()}">`;
const telegram = async url => ({ ok: !url.includes("down"), text: async () => page(url.includes("news") ? "$BTC breakout, buying" : "$BTC bullish, accumulating") });

test("the recorder reads the voices itself and stores the converged narrative only in the newest live day", async () => {
  const voices = await readVoices({ telegram: ["a_news", "b_news", "c_desk", "down_chan"], minVoices: 3 }, telegram);
  assert.deepEqual(voices.sources.map(s => s.posts), [1, 1, 1, 0]);
  assert.deepEqual(Object.keys(voices.kol), ["BTC"]);
  assert.equal(voices.kol.BTC.side, "bull");
  assert.equal(voices.kol.BTC.bull, 3);

  const real = globalThis.fetch; globalThis.fetch = fakeFetch;
  try {
    const ledger = [];
    await run(ledger, 2, voices.kol); // backfill: a narrative is about now, so replayed days never carry one
    assert.equal(ledger.length, 6);
    assert.ok(ledger.every(x => !x.evidence.kol));

    rows.push([t0 + 62 * day, 170, 172, 168, 170, 170, 100, 1], [t0 + 63 * day, 171, 173, 169, 171, 171, 100, 1]); // two new closed days
    await run(ledger, 0, voices.kol);
    const btc = ledger.filter(x => x.symbol === "BTCUSD").slice(-2);
    assert.equal(btc[0].evidence.kol, undefined); // the older of the two new days: no narrative
    assert.equal(btc[1].evidence.kol.side, "bull"); // the newest day cites the voices
    assert.ok(btc[1].verdict.bull.some(a => a.id === "kol_converge_bull" && /3 of 4/.test(a.because)));
    assert.ok(ledger.filter(x => x.symbol !== "BTCUSD").every(x => !x.evidence.kol)); // ETH and SOL did not converge
    assert.equal((await verifyChain(ledger)).ok, true); // the narrative is in the sealed evidence, so it re-judges
  } finally { globalThis.fetch = real; }
});
