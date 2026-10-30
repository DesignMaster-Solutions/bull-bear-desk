// Bull/Bear Desk: pure, deterministic agents. Same evidence in => same verdict out.
// No network and no randomness here, so any ledger entry can be re-judged and verified.

export const RULES_VERSION = "bbd-2"; // bbd-2 adds the KOL narrative rules; entries without e.kol judge exactly as bbd-1

const sma = (xs, n) => xs.slice(-n).reduce((a, b) => a + b, 0) / n;

function rsi(closes, n = 14) {
  let gain = 0, loss = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function atr(bars, n = 14) {
  let s = 0;
  for (let i = bars.length - n; i < bars.length; i++) {
    const { h, l } = bars[i], pc = bars[i - 1].c;
    s += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return s / n;
}

const r = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

// bars: [{t,o,h,l,c,v}] daily, oldest first (>= 60). fng: 0..100 Fear & Greed or null.
export function buildEvidence(symbol, bars, fng) {
  if (bars.length < 60) throw new Error("need 60 daily bars");
  const closes = bars.map(b => b.c), vols = bars.map(b => b.v);
  const price = closes.at(-1);
  return {
    symbol,
    asOf: bars.at(-1).t,
    price: r(price, 4),
    chg1d: r((price / closes.at(-2) - 1) * 100),
    chg7d: r((price / closes.at(-8) - 1) * 100),
    sma20: r(sma(closes, 20), 4),
    sma50: r(sma(closes, 50), 4),
    rsi14: r(rsi(closes)),
    atr14: r(atr(bars), 4),
    volRatio: r(vols.at(-1) / sma(vols.slice(0, -1), 20)),
    high30: r(Math.max(...closes.slice(-30)), 4),
    low30: r(Math.min(...closes.slice(-30)), 4),
    fng: fng ?? null,
  };
}

// Each rule: [id, side, weight, test(e), because(e)]. Transparent and versioned (RULES_VERSION).
const RULES = [
  ["trend_up", "bull", 2, e => e.price > e.sma20 && e.sma20 > e.sma50, e => `Price ${e.price} sits above SMA20 ${e.sma20}, which is above SMA50 ${e.sma50}: the trend is up.`],
  ["trend_down", "bear", 2, e => e.price < e.sma20 && e.sma20 < e.sma50, e => `Price ${e.price} sits below SMA20 ${e.sma20}, which is below SMA50 ${e.sma50}: the trend is down.`],
  ["momentum_7d_up", "bull", 1, e => e.chg7d >= 3, e => `Up ${e.chg7d}% over 7 days.`],
  ["momentum_7d_down", "bear", 1, e => e.chg7d <= -3, e => `Down ${e.chg7d}% over 7 days.`],
  ["oversold", "bull", 1, e => e.rsi14 < 30, e => `RSI14 ${e.rsi14} is oversold; mean reversion favors a bounce.`],
  ["overbought", "bear", 1, e => e.rsi14 > 70, e => `RSI14 ${e.rsi14} is overbought; the move is stretched.`],
  ["volume_confirms_up", "bull", 1, e => e.volRatio >= 1.5 && e.chg1d > 0, e => `Volume is ${e.volRatio}x its 20-day average on an up day: buyers are committed.`],
  ["volume_confirms_down", "bear", 1, e => e.volRatio >= 1.5 && e.chg1d < 0, e => `Volume is ${e.volRatio}x its 20-day average on a down day: sellers are committed.`],
  ["breakout", "bull", 1, e => e.price >= e.high30, e => `Closing at the 30-day high (${e.high30}).`],
  ["breakdown", "bear", 1, e => e.price <= e.low30, e => `Closing at the 30-day low (${e.low30}).`],
  ["crowd_fear", "bull", 1, e => e.fng !== null && e.fng <= 25, e => `Fear & Greed at ${e.fng} (extreme fear): contrarian buy zone.`],
  ["crowd_greed", "bear", 1, e => e.fng !== null && e.fng >= 75, e => `Fear & Greed at ${e.fng} (extreme greed): contrarian caution.`],
  // e.kol comes from narrative.js: trusted voices that converged on this token inside the window.
  ["kol_converge_bull", "bull", 2, e => e.kol?.side === "bull", e => `${e.kol.bull} of ${e.kol.voices} trusted voices converge bullish on ${e.kol.token} (avg conviction ${e.kol.conviction}).`],
  ["kol_converge_bear", "bear", 2, e => e.kol?.side === "bear", e => `${e.kol.bear} of ${e.kol.voices} trusted voices converge bearish on ${e.kol.token} (avg conviction ${e.kol.conviction}).`],
];

export function argue(side, e) {
  return RULES.filter(([, s, , test]) => s === side && test(e))
    .map(([id, , weight, , because]) => ({ id, weight, because: because(e) }));
}

// risk: { equity, riskPct, atrStop, atrTarget, maxPositionPct }
export const DEFAULT_RISK = { equity: 10000, riskPct: 1, atrStop: 2, atrTarget: 3, maxPositionPct: 25 };

// position: null or { side:"long", entry, qty, stop, target }
export function judge(e, position = null, risk = DEFAULT_RISK) {
  const bull = argue("bull", e), bear = argue("bear", e);
  const score = bull.reduce((a, x) => a + x.weight, 0) - bear.reduce((a, x) => a + x.weight, 0);
  let action = "HOLD", reason, trade = null;

  if (position) {
    if (e.price <= position.stop) { action = "EXIT"; reason = `Stop hit: ${e.price} <= ${position.stop}.`; }
    else if (e.price >= position.target) { action = "EXIT"; reason = `Target hit: ${e.price} >= ${position.target}.`; }
    else if (score <= -2) { action = "EXIT"; reason = `Bear case now outweighs bull case (score ${score}).`; }
    else reason = `Keep the long: score ${score}, stop ${position.stop}, target ${position.target}.`;
    if (action === "EXIT") trade = { side: "sell", qty: position.qty, price: e.price, pnl: r((e.price - position.entry) * position.qty) };
  } else if (score >= 2) {
    const stopDist = risk.atrStop * e.atr14;
    const byRisk = (risk.equity * risk.riskPct / 100) / stopDist;
    const byCap = (risk.equity * risk.maxPositionPct / 100) / e.price;
    const qty = r(Math.min(byRisk, byCap), 6);
    action = "BUY";
    reason = `Bull case wins (score ${score}). Size so a stop-out loses at most ${risk.riskPct}% of equity, capped at ${risk.maxPositionPct}% exposure.`;
    trade = { side: "buy", qty, price: e.price, stop: r(e.price - stopDist, 4), target: r(e.price + risk.atrTarget * e.atr14, 4) };
  } else {
    reason = score <= -2 ? `Bear case wins (score ${score}); long-only desk stays flat.` : `No edge (score ${score}); stay flat.`;
  }
  return { rules: RULES_VERSION, bull, bear, score, action, reason, trade };
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Hash chain: each entry commits to the previous hash, so editing history breaks every later hash.
export async function seal(entry, prevHash) {
  const body = { ...entry, prevHash };
  return { ...body, hash: await sha256(JSON.stringify(body)) };
}

// Re-run the judge on the stored evidence and recompute every hash.
export async function verifyChain(entries) {
  let prev = "genesis";
  for (const [i, x] of entries.entries()) {
    const { hash, ...body } = x;
    if (body.prevHash !== prev) return { ok: false, at: i, why: "prevHash mismatch" };
    if (await sha256(JSON.stringify(body)) !== hash) return { ok: false, at: i, why: "hash mismatch" };
    const again = judge(x.evidence, x.positionBefore, x.risk);
    if (again.action !== x.verdict.action || again.score !== x.verdict.score) return { ok: false, at: i, why: "verdict not reproducible" };
    prev = hash;
  }
  return { ok: true, entries: entries.length, head: prev };
}
