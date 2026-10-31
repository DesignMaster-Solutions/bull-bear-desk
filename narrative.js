// Multi-KOL Narrative Agent: pure and deterministic, like agents.js.
// Reads posts from up to 20 trusted voices, extracts token, sentiment, conviction and urgency,
// and detects when those voices converge on the same side of a token. The result is stored in the
// evidence (e.kol) so the bull/bear debate can cite it and verifyChain can re-judge it later.

export const MAX_VOICES = 20;

const NAMES = { bitcoin: "BTC", btc: "BTC", ethereum: "ETH", eth: "ETH", ether: "ETH", solana: "SOL", sol: "SOL",
  dogecoin: "DOGE", doge: "DOGE", xrp: "XRP", ripple: "XRP", cardano: "ADA", ada: "ADA", avalanche: "AVAX", avax: "AVAX",
  litecoin: "LTC", ltc: "LTC", pepe: "PEPE", shib: "SHIB", bnb: "BNB", sui: "SUI", chainlink: "LINK" };
const BULL = new Set("bullish long longs buy buying bought pump pumping moon breakout accumulate accumulating loading bid undervalued rip ath send ape higher".split(" "));
const BEAR = new Set("bearish short shorting sell selling sold dump dumping crash crashing rug breakdown overvalued exit trim capitulation rekt avoid lower".split(" "));
const BULL_PHRASES = ["to the moon", "bottom is in", "going up", "all time high"];
const BEAR_PHRASES = ["top is in", "going down", "get out"];
const NEG = new Set(["not", "no", "never", "dont", "don't", "isnt", "isn't", "aint", "ain't"]);
const STRONG = ["high conviction", "all in", "max long", "max short", "loading", "generational", "conviction", "huge"];
const HEDGE = ["maybe", "might", "could", "not sure", "small", "careful", "idk"];
const URGENT = ["right now", "now", "today", "tonight", "breaking", "just in", "asap", "last chance", "imminent", "urgent"];

const r2 = x => Math.round(x * 100) / 100;
const clamp = x => Math.max(0, Math.min(1, x));
const has = (text, words) => words.some(w => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(text));

// One post -> { tokens, sentiment -1..1, conviction 0..1, urgency 0..1 }.
export function readPost(text) {
  const raw = String(text);
  const low = raw.toLowerCase();
  const words = low.match(/[a-z']+/g) || [];
  const tokens = new Set([...raw.matchAll(/\$([A-Za-z][A-Za-z0-9]{1,9})\b/g)].map(m => m[1].toUpperCase()));
  for (const w of words) if (NAMES[w]) tokens.add(NAMES[w]);

  let bull = 0, bear = 0;
  words.forEach((w, i) => {
    const flip = NEG.has(words[i - 1]);
    if (BULL.has(w)) flip ? bear++ : bull++;
    if (BEAR.has(w)) flip ? bull++ : bear++;
  });
  bull += BULL_PHRASES.filter(p => low.includes(p)).length;
  bear += BEAR_PHRASES.filter(p => low.includes(p)).length;
  const sentiment = bull + bear ? r2((bull - bear) / (bull + bear)) : 0;

  const letters = raw.replace(/[^A-Za-z]/g, "");
  const shouting = /!!/.test(raw) || (letters.length > 8 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.6);
  const conviction = r2(clamp(0.4 + (has(low, STRONG) ? 0.3 : 0) + (shouting ? 0.1 : 0) - (has(low, HEDGE) ? 0.2 : 0)));
  const urgency = r2(clamp((has(low, URGENT) ? 0.6 : 0) + (/!!/.test(raw) ? 0.2 : 0)));
  return { tokens: [...tokens].sort(), sentiment, conviction, urgency };
}

const norm = a => String(a).trim().toLowerCase().replace(/^@/, "");

// posts: [{author, ts (ISO), text}]. Each trusted voice counts once per token: its latest non-neutral post.
// A side converges when >= minVoices voices take it and they outnumber the other side at least 2 to 1.
export function narrative(posts, { voices = [], minVoices = 3, windowHours = 24 } = {}) {
  const trusted = [...new Set(voices.map(norm).filter(Boolean))].slice(0, MAX_VOICES);
  const mine = posts.filter(p => trusted.includes(norm(p.author)) && p.ts).sort((a, b) => a.ts.localeCompare(b.ts));
  const newest = mine.length ? Date.parse(mine.at(-1).ts) : 0;
  const recent = mine.filter(p => newest - Date.parse(p.ts) <= windowHours * 3600e3);

  const stance = {}; // token -> author -> read post
  for (const p of recent) {
    const read = readPost(p.text);
    if (!read.sentiment) continue;
    for (const token of read.tokens) (stance[token] ??= {})[norm(p.author)] = { author: norm(p.author), ts: p.ts, text: p.text, ...read };
  }
  const tokens = Object.entries(stance).map(([token, byAuthor]) => {
    const all = Object.values(byAuthor);
    const bulls = all.filter(x => x.sentiment > 0), bears = all.filter(x => x.sentiment < 0);
    const side = bulls.length >= minVoices && bulls.length >= 2 * bears.length ? "bull"
      : bears.length >= minVoices && bears.length >= 2 * bulls.length ? "bear" : null;
    const lead = side === "bull" ? bulls : side === "bear" ? bears : all;
    const avg = k => r2(lead.reduce((a, x) => a + x[k], 0) / lead.length);
    return { token, side, bull: bulls.length, bear: bears.length, conviction: avg("conviction"), urgency: avg("urgency"), posts: all };
  }).sort((a, b) => (b.bull + b.bear) - (a.bull + a.bear) || a.token.localeCompare(b.token));
  return { voices: trusted.length, minVoices, windowHours, from: recent[0]?.ts ?? null, to: recent.at(-1)?.ts ?? null, tokens };
}

// "author: text" per line (posts copied from X, Discord or anywhere). Lines without an author are skipped.
export function parsePasted(text, ts = new Date().toISOString()) {
  return String(text).split("\n").map(l => l.match(/^\s*@?([\w.-]{1,40})\s*:\s*(.+)$/)).filter(Boolean)
    .map(m => ({ author: m[1], ts, text: m[2], source: "pasted" }));
}

// Public Telegram previews for each channel -> posts, plus how many posts each channel gave (fetchFn injectable for tests).
export async function fetchTelegram(channels, fetchFn = fetch) {
  const posts = [], sources = [];
  for (const c of channels) {
    const res = await fetchFn(`https://t.me/s/${c}`, { headers: { "User-Agent": "Mozilla/5.0 bull-bear-desk" } });
    const got = res.ok ? parseTelegram(c, await res.text()) : [];
    sources.push({ channel: c, posts: got.length });
    posts.push(...got);
  }
  return { posts, sources };
}

export const cleanChannels = list => [...new Set((list || []).map(c => String(c).trim().replace(/^@|^https?:\/\/t\.me\/(s\/)?/g, "")).filter(c => /^\w{4,40}$/.test(c)))].slice(0, MAX_VOICES);

// The evidence field the judge reads (e.kol), one per token the voices converged on.
export const converged = n => Object.fromEntries(n.tokens.filter(t => t.side)
  .map(t => [t.token, { token: t.token, side: t.side, bull: t.bull, bear: t.bear, voices: n.voices, conviction: t.conviction }]));

// What the recorder runs on its own every day: read the channels in kol.json, find the converged tokens.
export async function readVoices({ telegram, minVoices = 3, windowHours = 24 } = {}, fetchFn = fetch) {
  const channels = cleanChannels(telegram);
  const { posts, sources } = await fetchTelegram(channels, fetchFn);
  const n = narrative(posts, { voices: channels.map(c => `tg:${c}`), minVoices, windowHours });
  return { sources, narrative: n, kol: converged(n) };
}

const decode = s => s.replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// Public Telegram channel preview (https://t.me/s/<channel>): no API key, last ~20 posts with timestamps.
export function parseTelegram(channel, html) {
  return [...html.matchAll(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>[\s\S]*?datetime="([^"]+)"/g)]
    .map(m => ({ author: `tg:${norm(channel)}`, ts: m[2], text: decode(m[1]), source: "telegram" }));
}
