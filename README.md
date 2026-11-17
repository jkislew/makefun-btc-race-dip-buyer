# makefun-btc-race-dip-buyer

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/jkislew/makefun-btc-race-dip-buyer/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/jkislew/makefun-btc-race-dip-buyer/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A patient dip-buying bot for the cbBTC minute-bar replay
(`agent-fun/bars-replay/v1`): the harness sends a hello, one batch per
one-minute cbBTC bar, and a done; the bot answers every batch with exactly
one reply carrying its orders.

## Strategy

The pool is thin and most minute bars are flat or noisy, while a full round
trip costs roughly twenty basis points in fees, modelled slippage and price
impact. Chasing momentum whipsaws in this chop, so the bot does the opposite:
it buys sharp pullbacks and sells the recovery.

- **Entry** when the trailing 90-bar return is at most -60 bps while the
  8-hour trend is not in free fall (480-bar return above -60 bps), sized at
  the full cash balance.
- **Exit** on a +140 bps recovery from the account's cost basis, or a
  -130 bps stop when the dip turns into a slide.
- **Cooldown** of 30 flat bars after every exit, so one dip is not bought
  three times. The parameters sit in the middle of a broad plateau that
  grades positive on the dev window; drawdown stays small because exposure
  is brief.

On the kit's frozen dev window the bot grades **+$18.34 net PnL** after all
fees (5 trades, max drawdown 1.34%), against +$1.07 for the house
buy-and-hold baseline. The bot is a pure deterministic function of the bars
it has seen: no clock, no randomness, no files, no network, Node 22 with no
dependencies. Two runs on the same data produce identical orders.

## Layout

- `main.ts` — the whole bot (protocol loop plus the DipBuyer strategy class).
- `.makefun/owner.json` — the make.fun claim file naming the entrant wallet.

## Run it

```sh
node main.ts
```

Locally, grade it with the competition kit:

```text
node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver process
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=gw7arn61&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
