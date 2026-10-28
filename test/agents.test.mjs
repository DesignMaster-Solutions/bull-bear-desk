import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvidence, judge, seal, verifyChain, DEFAULT_RISK } from "../agents.js";

const bars = (fn) => Array.from({ length: 60 }, (_, i) => { const c = fn(i); return { t: `d${String(i).padStart(2, "0")}`, o: c, h: c * 1.01, l: c * 0.99, c, v: i === 59 ? 300 : 100 }; });
const up = buildEvidence("TESTUSDT", bars(i => 100 + i * 2), 20);
const down = buildEvidence("TESTUSDT", bars(i => 300 - i * 2), 80);

test("uptrend with fear and volume => BUY sized by risk", () => {
  const v = judge(up);
  assert.equal(v.action, "BUY");
  assert.ok(v.bull.some(x => x.id === "trend_up") && v.bull.some(x => x.id === "crowd_fear"));
  const lossAtStop = (v.trade.price - v.trade.stop) * v.trade.qty;
  assert.ok(lossAtStop <= DEFAULT_RISK.equity * DEFAULT_RISK.riskPct / 100 + 0.01);
  assert.ok(v.trade.qty * v.trade.price <= DEFAULT_RISK.equity * DEFAULT_RISK.maxPositionPct / 100 + 0.01);
});

test("downtrend => flat, and an open long is exited", () => {
  assert.equal(judge(down).action, "HOLD");
  const v = judge(down, { side: "long", entry: 200, qty: 1, stop: 10, target: 999 });
  assert.equal(v.action, "EXIT");
  assert.equal(v.trade.pnl, Math.round((down.price - 200) * 100) / 100);
});

test("stop hit exits regardless of score", () => {
  const v = judge(up, { side: "long", entry: 250, qty: 1, stop: up.price + 1, target: 999 });
  assert.equal(v.action, "EXIT");
  assert.match(v.reason, /Stop hit/);
});

test("hash chain verifies and catches tampering", async () => {
  const mk = async (prev, e) => seal({ symbol: "T", evidence: e, positionBefore: null, risk: DEFAULT_RISK, verdict: judge(e), positionAfter: null }, prev);
  const a = await mk("genesis", up), b = await mk(a.hash, down);
  assert.deepEqual((await verifyChain([a, b])).ok, true);
  const forged = { ...a, verdict: { ...a.verdict, action: "HOLD" } };
  assert.equal((await verifyChain([forged, b])).ok, false);
  const rehashed = await seal({ ...a, hash: undefined, prevHash: undefined, verdict: { ...a.verdict, action: "HOLD" } }, "genesis");
  delete rehashed.hash; const fixed = await seal(Object.fromEntries(Object.entries(rehashed).filter(([k]) => k !== "prevHash")), "genesis");
  const r = await verifyChain([fixed]);
  assert.equal(r.ok, false); assert.equal(r.why, "verdict not reproducible");
});
