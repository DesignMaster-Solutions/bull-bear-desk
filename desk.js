import { buildEvidence, judge, seal, DEFAULT_RISK } from "./agents.js";

export const SYMBOLS = ["BTCUSD", "ETHUSD", "SOLUSD"];
const UA = { "User-Agent": "Mozilla/5.0 bull-bear-desk" };

// Closed daily bars only (the open candle changes every second and would make verdicts unrepeatable).
// Kraken public OHLC: reachable from Cloudflare and GitHub Actions (Binance answers 403 there).
export async function dailyBars(symbol, limit) {
  const res = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${symbol}&interval=1440`, { headers: UA });
  if (!res.ok) throw new Error(`kraken ${res.status}`);
  const { error, result } = await res.json();
  if (error?.length) throw new Error(`kraken: ${error.join(", ")}`);
  const rows = Object.entries(result).find(([k]) => k !== "last")[1];
  const closed = rows.filter(k => (k[0] + 86400) * 1000 <= Date.now());
  return closed.slice(-limit).map(k => ({ t: new Date(k[0] * 1000).toISOString().slice(0, 10), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[6] }));
}

// Fear & Greed by date (YYYY-MM-DD), so replayed days use the reading of that day.
export async function fngByDate(days) {
  try {
    const res = await fetch(`https://api.alternative.me/fng/?limit=${days}`, { headers: UA });
    const { data } = await res.json();
    return Object.fromEntries(data.map(d => [new Date(d.timestamp * 1000).toISOString().slice(0, 10), +d.value]));
  } catch { return {}; }
}

function applyTrade(pos, v) {
  if (v.action === "BUY") return { side: "long", entry: v.trade.price, qty: v.trade.qty, stop: v.trade.stop, target: v.trade.target };
  if (v.action === "EXIT") return null;
  return pos;
}

// Appends one entry per closed day not yet judged, for each symbol. Idempotent per (symbol, day).
export async function run(ledger, replayDays = 0) {
  const fng = await fngByDate(Math.max(replayDays, 2) + 5);
  let added = 0;
  for (const symbol of SYMBOLS) {
    const mine = ledger.filter(x => x.symbol === symbol);
    const last = mine.at(-1);
    let pos = last ? last.positionAfter : null;
    const bars = await dailyBars(symbol, 60 + Math.max(replayDays, 1));
    const start = last ? bars.findIndex(b => b.t > last.evidence.asOf) : bars.length - Math.max(replayDays, 1);
    if (start < 0) continue;
    for (let i = Math.max(start, 59); i < bars.length; i++) {
      const evidence = buildEvidence(symbol, bars.slice(i - 59, i + 1), fng[bars[i].t] ?? null);
      const verdict = judge(evidence, pos, DEFAULT_RISK);
      const positionAfter = applyTrade(pos, verdict);
      const prevHash = ledger.at(-1)?.hash ?? "genesis";
      ledger.push(await seal({ symbol, mode: replayDays ? "replay" : "live", evidence, positionBefore: pos, risk: DEFAULT_RISK, verdict, positionAfter }, prevHash));
      pos = positionAfter;
      added++;
    }
  }
  return { added, total: ledger.length };
}

export function summary(ledger) {
  return SYMBOLS.map(symbol => {
    const mine = ledger.filter(x => x.symbol === symbol);
    const last = mine.at(-1);
    const closed = mine.filter(x => x.verdict.action === "EXIT").map(x => x.verdict.trade.pnl);
    const open = last?.positionAfter;
    const unrealized = open ? Math.round((last.evidence.price - open.entry) * open.qty * 100) / 100 : 0;
    return {
      symbol, days: mine.length, last,
      trades: mine.filter(x => x.verdict.action === "BUY").length,
      wins: closed.filter(p => p > 0).length, losses: closed.filter(p => p <= 0).length,
      realized: Math.round(closed.reduce((a, b) => a + b, 0) * 100) / 100, unrealized,
    };
  });
}

