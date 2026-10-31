import { buildEvidence, judge, verifyChain, DEFAULT_RISK } from "./agents.js";
import { narrative, parsePasted, fetchTelegram, cleanChannels, converged } from "./narrative.js";
import { dailyBars, fngByDate, summary } from "./desk.js";

const LEDGER_URL = "https://raw.githubusercontent.com/DesignMaster-Solutions/bull-bear-desk/main/ledger.json";

// The ledger lives in git (appended daily by GitHub Actions), so its history is public and timestamped.
async function load() {
  const res = await fetch(LEDGER_URL, { cf: { cacheTtl: 300 } });
  return res.ok ? res.json() : [];
}

const json = (o, s = 200) => new Response(JSON.stringify(o, null, 2), { status: s, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/summary") return json(summary(await load()));
    if (url.pathname === "/api/ledger") {
      const ledger = await load();
      const symbol = url.searchParams.get("symbol");
      return json(symbol ? ledger.filter(x => x.symbol === symbol) : ledger);
    }
    if (url.pathname === "/api/verify") return json(await verifyChain(await load()));
    if (url.pathname === "/api/preview") {
      // What the desk would decide right now for any Kraken USD pair, without recording.
      const symbol = (url.searchParams.get("symbol") || "BTCUSD").toUpperCase().replace(/[^A-Z0-9]/g, "");
      try {
        const bars = await dailyBars(symbol, 60);
        const fng = await fngByDate(2);
        const evidence = buildEvidence(symbol, bars.slice(-60), fng[bars.at(-1).t] ?? null);
        return json({ evidence, verdict: judge(evidence) });
      } catch (e) { return json({ error: String(e.message || e) }, 400); }
    }
    if (url.pathname === "/api/narrative" && req.method === "POST") {
      try { return json(await narrativeDesk(await req.json())); } catch (e) { return json({ error: String(e.message || e) }, 400); }
    }
    return env.ASSETS.fetch(req);
  },
};

const num = (x, lo, hi, d) => (Number.isFinite(+x) && x !== "" && x !== null ? Math.min(hi, Math.max(lo, +x)) : d);

// Multi-KOL narrative: read the trusted voices, find converged tokens, then let the same bull/bear judge
// size a practice position for each one with the user's risk limits. Nothing is recorded.
async function narrativeDesk(body) {
  const channels = cleanChannels(body.telegram);
  const voices = [...(body.voices || []), ...channels.map(c => `tg:${c}`)];
  const { posts: tg, sources } = await fetchTelegram(channels);
  const posts = [...parsePasted(body.posts || ""), ...tg];
  const n = narrative(posts, { voices, minVoices: num(body.minVoices, 1, 20, 3), windowHours: num(body.windowHours, 1, 168, 24) });
  const kols = converged(n);
  const risk = { ...DEFAULT_RISK, riskPct: num(body.riskPct, 0.1, 5, DEFAULT_RISK.riskPct), maxPositionPct: num(body.maxPositionPct, 1, 100, DEFAULT_RISK.maxPositionPct) };
  const fng = await fngByDate(2);
  const decisions = [];
  for (const t of n.tokens.filter(x => x.side).slice(0, 5)) {
    try {
      const bars = await dailyBars(`${t.token}USD`, 60);
      const evidence = { ...buildEvidence(`${t.token}USD`, bars.slice(-60), fng[bars.at(-1).t] ?? null), kol: kols[t.token] };
      decisions.push({ token: t.token, evidence, verdict: judge(evidence, null, risk) });
    } catch (e) { decisions.push({ token: t.token, error: `No Kraken ${t.token}/USD daily data: ${e.message || e}` }); }
  }
  return { sources, risk, narrative: n, decisions };
}
