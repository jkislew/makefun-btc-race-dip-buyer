// Dip buyer for the cbBTC minute-bar replay (agent-fun/bars-replay/v1).
//
// Design notes, from the shape of this market and the kit's own baselines:
//   * The pool is thin, most one-minute bars are flat or noisy, and a full
//     round trip costs roughly twenty basis points in fees, modelled
//     slippage and price impact. Chasing momentum on minute bars whipsaws:
//     the house EMA-cross baseline trades dozens of times and loses heavily.
//   * This window's hourly swings are large and mostly mean-reverting, so
//     the bot does the opposite of chasing: it buys sharp pullbacks. When
//     the trailing 90-bar return is at most -60 bps while the 8-hour trend
//     is not in free fall (480-bar return above -60 bps), it buys with its
//     full cash. Full size is affordable because the take-profit is wide.
//   * It sells on a +140 bps recovery from its cost basis, or on a -130 bps
//     stop when the dip turns into a slide. Between trades it waits out a
//     30-bar cooldown so one dip cannot be bought three times.
//   * The parameter plateau is broad (dip 50-70, take 120-160, stop 90-130
//     all grade positive on the dev window), so the strategy is a shape,
//     not a point fit. Drawdown stays small because exposure is brief.
//   * Everything is a deterministic function of the bars seen so far: no
//     clock, no randomness, no files, no network. Two runs on the same
//     data produce the same orders byte for byte.

import * as readline from "node:readline";

// ---- tunable constants (basis points unless noted) --------------------------
const DIP_LOOKBACK = 90;        // bars, pullback measurement horizon
const DIP_BPS = 60.0;           // buy when the lookback return is at most -this
const TREND_LOOKBACK = 480;     // bars, long trend filter horizon
const TREND_FLOOR_BPS = -60.0;  // no buying when the long trend is below this
const TAKE_PROFIT_BPS = 140.0;  // sell when the gain from cost reaches this
const STOP_LOSS_BPS = 130.0;    // sell when the loss from cost reaches this
const COOLDOWN = 30;            // bars flat after an exit before any re-entry
const WARMUP = 120;             // bars of history before the first possible entry
const MAX_SLIP = 200;           // max_slippage_bps sent with every order
const MIN_NOTIONAL = 1000000n;  // 1 USDC in quote units

type Order = Record<string, unknown>;

class DipBuyer {
  closes: number[] = [];
  inPosition = false;
  entryPrice: number | null = null;
  barsSinceExit = COOLDOWN + 1;
  orderNo = 0;
  symbol = "CBBTC";
  // Bar prices are integers at price_scale; the account's cost basis is in
  // quote units per qty unit. entryScale converts cost/qty into the same
  // integer scale as the bar prices: 10^(qty_scale - quote_scale + price_scale).
  entryScale = 1.0;

  retBps(barsBack: number): number {
    if (this.closes.length <= barsBack) return 0.0;
    const then = this.closes[this.closes.length - 1 - barsBack];
    if (then <= 0.0) return 0.0;
    return (this.closes[this.closes.length - 1] / then - 1.0) * 10000.0;
  }

  gainBps(close: number): number {
    if (this.entryPrice === null || this.entryPrice <= 0.0) return 0.0;
    return (close / this.entryPrice - 1.0) * 10000.0;
  }

  onBar(close: number, cash: bigint, posQty: bigint, posCost: bigint): Order[] {
    this.closes.push(close);

    const holding = posQty > 0n;
    if (holding && !this.inPosition) {
      // A buy fill landed since the last batch: adopt the position and
      // derive the entry price from the account's own cost basis.
      this.inPosition = true;
      this.entryPrice = posCost > 0n ? (Number(posCost) / Number(posQty)) * this.entryScale : close;
    }
    if (!holding && this.inPosition) {
      // A sell fill landed: the book is flat again, start the cooldown.
      this.inPosition = false;
      this.entryPrice = null;
      this.barsSinceExit = 0;
    }

    const orders: Order[] = [];
    if (this.inPosition) {
      const gain = this.gainBps(close);
      if (gain >= TAKE_PROFIT_BPS || gain <= -STOP_LOSS_BPS) {
        this.orderNo += 1;
        orders.push({
          side: "sell",
          client_id: "s" + this.orderNo,
          symbol: this.symbol,
          qty: posQty.toString(),
          max_slippage_bps: MAX_SLIP,
        });
      }
    } else {
      this.barsSinceExit += 1;
      if (this.shouldEnter(cash)) {
        this.orderNo += 1;
        orders.push({
          side: "buy",
          client_id: "b" + this.orderNo,
          symbol: this.symbol,
          notional_quote_units: cash.toString(),
          max_slippage_bps: MAX_SLIP,
        });
      }
    }
    return orders;
  }

  shouldEnter(cash: bigint): boolean {
    if (this.closes.length < WARMUP) return false;
    if (this.barsSinceExit <= COOLDOWN) return false;
    if (cash < MIN_NOTIONAL) return false;
    if (this.retBps(TREND_LOOKBACK) < TREND_FLOOR_BPS) return false;
    if (this.retBps(DIP_LOOKBACK) > -DIP_BPS) return false;
    return true;
  }
}

function main(): void {
  const buyer = new DipBuyer();
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line: string) => {
    const text = line.trim();
    if (!text) return;
    const msg = JSON.parse(text);
    if (msg.type === "hello") {
      if (Array.isArray(msg.symbols) && msg.symbols.length > 0) {
        const sym = msg.symbols[0];
        buyer.symbol = sym.symbol;
        const quoteScale = msg.capital?.quote_scale ?? 6;
        const exponent = (sym.qty_scale ?? 8) - quoteScale + (sym.price_scale ?? 5);
        buyer.entryScale = Math.pow(10, exponent);
      }
      return;
    }
    if (msg.type === "done") {
      rl.close();
      return;
    }
    if (msg.type !== "batch") return;

    const account = msg.account;
    const cash = BigInt(account.cash_quote_units);
    let qty = 0n;
    let cost = 0n;
    for (const pos of account.positions ?? []) {
      if (pos.symbol === buyer.symbol) {
        qty = BigInt(pos.qty);
        cost = BigInt(pos.cost_quote_units);
      }
    }
    let close: number | null = null;
    for (const bar of msg.bars ?? []) {
      if (bar.symbol === buyer.symbol) close = Number(bar.c);
    }
    let orders: Order[] = [];
    if (close !== null && close > 0) {
      orders = buyer.onBar(close, cash, qty, cost);
    }
    process.stdout.write(
      JSON.stringify({ type: "reply", seq: msg.seq, orders }) + "\n",
    );
  });
}

main();
