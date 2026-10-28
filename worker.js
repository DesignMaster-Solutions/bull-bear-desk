import { buildEvidence, judge, verifyChain } from "./agents.js";
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
    return env.ASSETS.fetch(req);
  },
};
