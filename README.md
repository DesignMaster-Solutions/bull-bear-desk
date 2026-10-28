# Bull/Bear Desk

An autonomous practice-trading agent for the RYO-CHAN "Autonomous Agents" bounty (BLI Legal Tech Hackathon 2).
It interprets market evidence, records the practice trade it would make, and keeps a reasoning trail anyone can repeat.

Live: https://bull-bear-desk.designmaster.workers.dev

Demo video (2:32): [docs/demo.mp4](docs/demo.mp4)

## How it decides

1. **Evidence** (`buildEvidence`): from closed Kraken daily candles and the Fear & Greed index of that day: price, 1d/7d change, SMA20/SMA50, RSI14, ATR14, volume vs its 20-day average, 30-day high/low.
2. **Bull agent and bear agent** (`argue`): each reads the same evidence and argues only its side, citing the number behind every claim. Rules and weights are published in `agents.js` and versioned (`RULES_VERSION`).
3. **Judge** (`judge`): score = bull weight minus bear weight. Flat and score >= 2: buy. Long and stop hit, target hit or score <= -2: exit. Otherwise hold, with the reason written out.
4. **Risk limits**: a stop-out loses at most 1% of a 10,000 practice account (stop = 2x ATR, target = 3x ATR) and exposure is capped at 25%. Long-only: a bear win means stay flat.
5. **Trail**: every decision stores the evidence, the position before and after, both arguments, the verdict and the risk settings, chained by SHA-256 (`prevHash` -> `hash`). `verifyChain` recomputes every hash and re-runs the judge on the stored evidence; an edited entry or a verdict that does not reproduce breaks the chain.

## Where the trail lives

`ledger.json` in this repo. A GitHub Action (`.github/workflows/record.yml`) appends the new closed day for BTC, ETH and SOL every day at 00:10 UTC, after the tests pass, so git history is the public timestamp of each decision. The first 90 days were backfilled with `node record.mjs --replay 90` and are marked `"mode": "replay"`; daily entries are `"mode": "live"`.

## API

- `GET /api/summary`: per-pair last debate, trades, wins/losses, realized and open P&L
- `GET /api/ledger?symbol=BTCUSD`: the trail
- `GET /api/verify`: re-hash and re-judge the whole trail
- `GET /api/preview?symbol=DOGEUSD`: what the desk would decide now for any Kraken USD pair (not recorded)

## Run

```
npm test
node record.mjs            # append new closed days
npx wrangler deploy        # Cloudflare Worker + static page
```

Practice trades only. No real orders, no investment advice. Built by Design Master Solutions LLC.
