import { test } from "node:test";
import assert from "node:assert/strict";
import { readPost, narrative, parsePasted, parseTelegram } from "../narrative.js";
import { buildEvidence, judge } from "../agents.js";

test("reads tokens, sentiment, conviction and urgency from one post", () => {
  const p = readPost("Loading more $SOL right now, high conviction breakout!!");
  assert.deepEqual(p.tokens, ["SOL"]);
  assert.ok(p.sentiment > 0 && p.conviction >= 0.7 && p.urgency >= 0.5);
  const n = readPost("I am not bullish on ethereum, maybe trim");
  assert.deepEqual(n.tokens, ["ETH"]);
  assert.ok(n.sentiment < 0 && n.conviction < 0.5);
  assert.equal(readPost("gm frens").tokens.length, 0);
});

const t = h => new Date(Date.UTC(2026, 9, 30, h)).toISOString();
const posts = [
  { author: "a", ts: t(1), text: "$SOL looks bullish, accumulating" },
  { author: "b", ts: t(2), text: "Buying SOL here, breakout" },
  { author: "c", ts: t(3), text: "solana to the moon, all in" },
  { author: "d", ts: t(4), text: "selling $SOL, top is in" },
  { author: "x", ts: t(4), text: "SOL pump pump pump" }, // not a trusted voice
  { author: "a", ts: t(5), text: "$ETH dump incoming" },
];

test("convergence counts each trusted voice once and ignores untrusted ones", () => {
  const n = narrative(posts, { voices: ["a", "b", "c", "d"], minVoices: 3 });
  const sol = n.tokens.find(x => x.token === "SOL");
  assert.equal(sol.bull, 3);
  assert.equal(sol.bear, 1);
  assert.equal(sol.side, "bull");
  assert.equal(n.tokens.find(x => x.token === "ETH").side, null);
  assert.ok(!sol.posts.some(p => p.author === "x"));
});

test("a divided crowd is not convergence", () => {
  const n = narrative([...posts, { author: "e", ts: t(5), text: "short SOL" }, { author: "f", ts: t(5), text: "SOL bearish" }], { voices: ["a", "b", "c", "d", "e", "f"], minVoices: 3 });
  assert.equal(n.tokens.find(x => x.token === "SOL").side, null);
});

test("posts outside the window and voices beyond 20 are dropped", () => {
  const voices = Array.from({ length: 25 }, (_, i) => `v${i}`);
  const n = narrative([{ author: "v24", ts: t(5), text: "$BTC bullish" }, { author: "v0", ts: t(5), text: "$BTC bullish" }], { voices, minVoices: 1 });
  assert.equal(n.voices, 20);
  assert.equal(n.tokens[0].bull, 1);
  const old = narrative([{ author: "a", ts: t(0), text: "$BTC bullish" }, { author: "b", ts: new Date(Date.UTC(2026, 9, 31, 12)).toISOString(), text: "$BTC bullish" }], { voices: ["a", "b"], minVoices: 2, windowHours: 24 });
  assert.equal(old.tokens[0].bull, 1);
});

test("converged narrative becomes a weighted, cited argument in the debate", () => {
  const bars = Array.from({ length: 60 }, (_, i) => ({ t: `d${i}`, o: 100, h: 101, l: 99, c: 100, v: 100 }));
  const flat = buildEvidence("SOLUSD", bars, 50);
  const base = judge(flat);
  const kol = narrative(posts, { voices: ["a", "b", "c", "d"], minVoices: 3 }).tokens.find(x => x.token === "SOL");
  const v = judge({ ...flat, kol: { token: kol.token, side: kol.side, bull: kol.bull, bear: kol.bear, voices: 4, conviction: kol.conviction } });
  assert.equal(v.score, base.score + 2);
  assert.ok(v.bull.some(x => x.id === "kol_converge_bull" && /3 of 4/.test(x.because)));
});

test("pasted lines and Telegram HTML become posts", () => {
  assert.deepEqual(parsePasted("@cobie: $BTC bullish\nno author line").map(p => p.author), ["cobie"]);
  const html = '<div class="tgme_widget_message_text js-message_text" dir="auto"><b>JUST IN:</b> &#036;BTC breaks out</div></div><a><time datetime="2026-10-30T20:36:52+00:00">';
  const [p] = parseTelegram("watcherguru", html);
  assert.equal(p.author, "tg:watcherguru");
  assert.equal(p.ts, "2026-10-30T20:36:52+00:00");
  assert.match(p.text, /\$BTC breaks out/);
});
