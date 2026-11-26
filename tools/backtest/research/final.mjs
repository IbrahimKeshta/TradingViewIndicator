// Final exam: ONE rule set, run once on data no idea was tuned on (see the plan doc).
//   node --max-old-space-size=12000 tools/backtest/research/final.mjs --name "F8 F4 pool ema200 trail8"
import fs from 'node:fs';
import { loadFeatures } from './features.mjs';
import { simulate, stats } from './sim.mjs';
import { families } from './families.mjs';

const arg = (k, d = null) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const name = arg('name');
const fam = families().find((x) => x.name === name);
if (!fam) throw new Error('no config ' + name);
const COINS = ['NEARUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'FILUSDT', 'UNIUSDT', 'AAVEUSDT', 'ETCUSDT', 'XLMUSDT', 'HBARUSDT'];
const EGX = fs.readFileSync('data/sof/final-egx-list.txt', 'utf8').trim().split(',');
const SETS = [['eDF', EGX, 'primary'], ['c240F', COINS, 'primary'], ['e60F', EGX, 'secondary'], ['c1440F', COINS, 'secondary'], ['c60F', COINS, 'secondary']];
const out = {};
console.log(`FINAL EXAM — ${name}`);
for (const [set, syms, role] of SETS) {
  const crypto = set.startsWith('c');
  const costs = crypto ? { pct: 0.1 } : { pct: 0.1, commission: 2, positionSize: 100000 };
  let all = [];
  const per = [];
  for (const s of syms) {
    const f = loadFeatures(set, s);
    if (fam.prep) fam.prep(f);
    const tr = simulate(f, fam, costs);
    all = all.concat(tr);
    const st = stats(tr); per.push([s, st.n, st.tot]);
  }
  const s = stats(all);
  const pass1 = s.avg >= 0.10, pass2 = s.symPos >= 0.60;
  out[set] = { role, ...s, per };
  console.log(`\n${set} (${role}, ${syms.length} symbols): n=${s.n} avg ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(3)}R gross ${s.gross.toFixed(3)} win ${(s.win * 100).toFixed(0)}% PF ${s.pf.toFixed(2)} | symbols positive ${(s.symPos * 100).toFixed(0)}% of ${s.symN} | long ${s.longAvg.toFixed(3)} (${s.nL}) short ${s.shortAvg.toFixed(3)} (${s.nS})`);
  console.log(`   avg >= +0.10: ${pass1 ? 'PASS' : 'fail'}   symbols >= 60%: ${pass2 ? 'PASS' : 'fail'}   => ${pass1 && pass2 ? 'PASSES' : 'FAILS'}`);
  console.log('   per symbol (n, total R): ' + per.map(([a, n, t]) => `${a.replace('USDT', '')} ${n}/${t >= 0 ? '+' : ''}${t.toFixed(1)}`).join('  '));
}
fs.mkdirSync('out/research', { recursive: true });
fs.writeFileSync('out/research/final.json', JSON.stringify({ name, out }));
