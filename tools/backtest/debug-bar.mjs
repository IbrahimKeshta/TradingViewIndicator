// Print engine state on selected dates:  node debug-bar.mjs SYM date1,date2 [--data dir] [--cfg json]
import path from 'node:path';
import { runEngine } from './ict-engine.mjs';
import { loadSymbol, loadMeta, DATA_DIR } from './data.mjs';
const [sym, dates] = [process.argv[2], process.argv[3].split(',')];
const a = process.argv.slice(4);
const dir = a.includes('--data') ? path.resolve(a[a.indexOf('--data') + 1]) : DATA_DIR;
const cfg = a.includes('--cfg') ? JSON.parse(a[a.indexOf('--cfg') + 1]) : {};
const bars = loadSymbol(sym, dir);
const f = (x) => (typeof x === 'number' ? +x.toFixed(4) : x);
runEngine(bars, cfg, { symbol: sym, mintick: loadMeta(dir)[sym]?.mintick ?? 0.01, onBar: (i, s) => {
  if (!dates.includes(bars[i].date)) return;
  console.log('---', bars[i].date, 'i=' + i, 'O', bars[i].open, 'H', bars[i].high, 'L', bars[i].low, 'C', bars[i].close);
  const { bullTouch, bearTouch, pbTrade, trTrade, majorHighs, majorLows, intHighs, intLows, bullFvg, bullOb, bearFvg, bearOb, csL, csS, ...rest } = s;
  console.log(Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, f(v)])));
  console.log('csL', JSON.stringify(csL), 'csS', JSON.stringify(csS));
  console.log('touch bull', JSON.stringify(bullTouch), 'bear', JSON.stringify(bearTouch));
  const sw = (p) => p.map((x) => `${bars[x.bar]?.date}:${f(x.price)}${x.broken ? 'x' : ''}${x.liquidity ? 'L' : ''}`).join(' ');
  console.log('majorHighs', sw(majorHighs)); console.log('majorLows', sw(majorLows)); console.log('intHighs', sw(intHighs)); console.log('intLows', sw(intLows));
  console.log('pb', pbTrade && { side: pbTrade.side, openBar: bars[pbTrade.openBar].date, stop: pbTrade.stop, reason: pbTrade.closeReason }, 'tr', trTrade && { side: trTrade.side, openBar: bars[trTrade.openBar].date, stop: trTrade.stop, reason: trTrade.closeReason });
} });
