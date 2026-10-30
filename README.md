# Bull/Bear Desk

An autonomous practice-trading agent for the RYO-CHAN "Autonomous Agents" bounty (BLI Legal Tech Hackathon 2).
It interprets market evidence, records the practice trade it would make, and keeps a reasoning trail anyone can repeat.

Live: https://bull-bear-desk.designmaster.workers.dev

Demo video (2:33): https://youtu.be/xDoT_PQMIW8 (also in [docs/demo.mp4](docs/demo.mp4))

## How it decides

1. **Evidence** (`buildEvidence`): from closed Kraken daily candles and the Fear & Greed index of that day: price, 1d/7d change, SMA20/SMA50, RSI14, ATR14, volume vs its 20-day average, 30-day high/low.
2. **Bull agent and bear agent** (`argue`): each reads the same evidence and argues only its side, citing the number behind every claim. Rules and weights are published in `agents.js` and versioned (`RULES_VERSION`).
3. **Judge** (`judge`): score = bull weight minus bear weight. Flat and score >= 2: buy. Long and stop hit, target hit or score <= -2: exit. Otherwise hold, with the reason written out.
4. **Risk limits**: a stop-out loses at most 1% of a 10,000 practice account (stop = 2x ATR, target = 3x ATR) and exposure is capped at 25%. Long-only: a bear win means stay flat.
5. **Trail**: every decision stores the evidence, the position before and after, both arguments, the verdict and the risk settings, chained by SHA-256 (`prevHash` -> `hash`). `verifyChain` recomputes every hash and re-runs the judge on the stored evidence; an edited entry or a verdict that does not reproduce breaks the chain.

## Multi-KOL narrative agent (Special Project Spotlight)

`narrative.js`, same rules as the rest: pure, deterministic, no LLM, no randomness.

1. **Sources**: up to 20 trusted voices (`MAX_VOICES`). Posts copied from X or Discord as `author: text`, and public Telegram channels read live from `https://t.me/s/<channel>` (no API key; the last ~20 posts with timestamps). Posts from anyone outside the trusted list are ignored.
2. **Per post** (`readPost`): mentioned tokens (`$TICKER` and common names: bitcoin, solana...), sentiment -1..1 from a published bull/bear lexicon with negation ("not bullish" counts as bearish), conviction 0..1 ("high conviction", "all in", shouting raise it; "maybe", "small" lower it) and urgency 0..1 ("now", "today", "breaking", "just in").
3. **Convergence** (`narrative`): inside the window (default 24 h), each voice counts once per token, by its latest non-neutral post. A side converges when at least N voices (default 3) take it and outnumber the other side at least 2 to 1. A divided crowd is not a narrative.
4. **Decision**: a converged narrative is stored in the evidence as `e.kol` and becomes a cited argument in the same debate (`kol_converge_bull` / `kol_converge_bear`, weight 2, rules `bbd-2`). The judge then sizes the practice position with the user's risk per trade and max exposure (`POST /api/narrative`). Because `e.kol` lives in the evidence, any such decision can be re-judged by `verifyChain` like the daily ones. Entries without `e.kol` judge exactly as `bbd-1`, and the existing 276-entry ledger still verifies.

Limits, stated: X has no free read API, so X posts are pasted, not fetched; sentiment is a lexicon, not a language model, so sarcasm reads literally; a post's sentiment applies to every token it mentions.

## Where the trail lives

`ledger.json` in this repo. A GitHub Action (`.github/workflows/record.yml`) appends the new closed day for BTC, ETH and SOL every day at 00:10 UTC, after the tests pass, so git history is the public timestamp of each decision. The first 90 days were backfilled with `node record.mjs --replay 90` and are marked `"mode": "replay"`; daily entries are `"mode": "live"`.

## API

- `GET /api/summary`: per-pair last debate, trades, wins/losses, realized and open P&L
- `GET /api/ledger?symbol=BTCUSD`: the trail
- `GET /api/verify`: re-hash and re-judge the whole trail
- `GET /api/preview?symbol=DOGEUSD`: what the desk would decide now for any Kraken USD pair (not recorded)
- `POST /api/narrative` `{voices, posts, telegram, minVoices, windowHours, riskPct, maxPositionPct}`: Multi-KOL narrative, converged tokens and the practice position for each (not recorded)

## Run

```
npm test
node record.mjs            # append new closed days
npx wrangler deploy        # Cloudflare Worker + static page
```

Practice trades only. No real orders, no investment advice. Built by Design Master Solutions LLC.
