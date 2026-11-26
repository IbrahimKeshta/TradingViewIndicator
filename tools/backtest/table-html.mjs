// Renders the before → after table of a standard-report.mjs / sof-vs-ict-report.mjs markdown file as a styled HTML page
// (the screenshot layout of the Smart Confluence backtest standard). Open the page in a browser and screenshot the card.
//
//   node tools/backtest/table-html.mjs --md <report.md> --out <page.html> --header "| Variant (current → variant)"
//        [--title "..."] [--sub "..."] [--foot "..."]
//
// --header is the start of the table's header line: "| Variant (current → variant)" (standard-report) or
// "| Model (ICT current → model)" (sof-vs-ict-report). --title / --sub / --foot are HTML. Text in backticks becomes a code pill.
import fs from 'node:fs';
import { parseArgs } from './egx100-common.mjs';

const args = parseArgs();
for (const k of ['md', 'out', 'header']) if (!args[k]) throw new Error(`--${k} is required`);
const md = fs.readFileSync(args.md, 'utf8').split(/\r?\n/);
const start = md.findIndex((l) => l.startsWith(args.header));
if (start < 0) throw new Error('header not found: ' + args.header);
const heads = md[start].split('|').slice(1, -1).map((c) => c.trim());
const rows = [];
for (let i = start + 2; i < md.length && md[i].startsWith('|'); i++) rows.push(md[i].split('|').slice(1, -1).map((c) => c.trim()));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const pills = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>');
const dot = (s) => s.replace(' 🟢', ' <span class="dot g"></span>').replace(' 🔴', ' <span class="dot r"></span>');
const cell = (c) => {
  const m = c.match(/^(.*?) → \*\*(.*?)\*\*(.*)$/); // "old → **new** 🟢 (+123)"
  if (!m) return esc(c);
  let rest = m[3].trim(), delta = '';
  const d = rest.match(/\(([+-][\d,]+)\)/);
  if (d) { delta = `<div class="delta">(${d[1]})</div>`; rest = rest.replace(d[0], '').trim(); }
  return `<span class="old">${esc(m[1])}</span> → <b>${esc(m[2])}</b>${dot(rest ? ' ' + rest : '')}${delta}`;
};
const label = (c) => { const m = c.match(/^`(.*?)` \((.*)\)$/); return m ? `<code>${esc(m[1])}</code> <span class="desc">(${esc(m[2])})</span>` : esc(c); };

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#fff;font-family:"Segoe UI",Inter,Arial,sans-serif;color:#1f2328}
#wrap{display:inline-block;padding:28px 32px 24px}
h1{font-size:20px;font-weight:600;text-align:center;margin:0 0 6px}
h1 code{font-size:17px}
.sub{font-size:12.5px;color:#57606a;text-align:center;margin:0 auto 16px;max-width:1500px}
table{border-collapse:separate;border-spacing:0;border:1px solid #d8dee4;border-radius:12px;overflow:hidden;font-size:13.5px}
th{background:#f3f4f6;font-weight:600;padding:12px 10px;border-bottom:1px solid #d8dee4;white-space:nowrap;text-align:center}
th:first-child{text-align:left}
td{padding:10px;border-bottom:1px solid #eaeef2;text-align:center;white-space:nowrap;vertical-align:middle}
tr:last-child td{border-bottom:none}
td:first-child{text-align:left;white-space:normal;width:250px;line-height:1.35}
th+th,td+td{border-left:1px solid #eaeef2}
code{background:#eff1f3;color:#0b5394;padding:2px 6px;border-radius:5px;font-family:Consolas,monospace;font-size:12.5px}
.desc,.old,.delta{color:#444c56}.desc,.delta{font-size:12.5px}.delta{margin-top:2px}
b{font-weight:700}
.dot{display:inline-block;width:11px;height:11px;border-radius:50%;vertical-align:-1px;margin-left:3px}
.g{background:#22a447}.r{background:#e5322d}
.foot{font-size:12px;color:#57606a;margin-top:12px;max-width:1500px}
</style></head><body><div id="wrap">
${args.title ? `<h1>${pills(args.title)}</h1>` : ''}
${args.sub ? `<p class="sub">${pills(args.sub)}</p>` : ''}
<table><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>
${rows.map((r) => `<tr><td>${label(r[0])}</td>${r.slice(1).map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`).join('\n')}
</table>
${args.foot ? `<div class="foot">${pills(args.foot)}</div>` : ''}
</div></body></html>`;
fs.writeFileSync(args.out, html);
console.log(`${rows.length} rows -> ${args.out}`);
