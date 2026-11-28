// Reads CHANGELOG.md: validates it, reports what is unreleased, and prints the notes for one release.
//
//   node tools/release/changelog.mjs check                      exit 1 on any problem
//   node tools/release/changelog.mjs status                     latest version + pending changes per component
//   node tools/release/changelog.mjs notes <slug> [version] [--format md|tradingview]
//
// Shape (see the top of CHANGELOG.md):
//   ## <slug> — <title>                 one section per shipped component
//   ### [Unreleased]                    always present, first
//   ### [1.2.0] - 2026-11-28            newest first
//   #### Added | Changed | Fixed | Removed | Deprecated | Security
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

// Components whose version also lives in a file the build reads. The file must equal the newest release.
export const VERSION_FILES = { thndrx: 'tools/thndrx/VERSION' };

const COMPONENT = /^## ([a-z][a-z0-9-]*) — (.+)$/;
const RELEASE = /^### \[(Unreleased|\d+\.\d+\.\d+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/;
const TYPE = /^#### (.+)$/;
const TYPES = ['Added', 'Changed', 'Fixed', 'Removed', 'Deprecated', 'Security'];

export function parse(text) {
  const components = {};
  let comp = null, rel = null;
  for (const line of text.split(/\r?\n/)) {
    let m;
    if ((m = COMPONENT.exec(line))) {
      comp = components[m[1]] = { slug: m[1], title: m[2].trim(), releases: [], problems: [] };
      rel = null;
    } else if (/^## /.test(line)) {
      comp = rel = null; // a non-component H2 (e.g. "How this file works") ends the component
    } else if (comp && (m = RELEASE.exec(line))) {
      rel = { version: m[1], date: m[2] ?? null, lines: [] };
      comp.releases.push(rel);
    } else if (comp && /^### /.test(line)) {
      comp.problems.push(`bad release heading: ${line}`);
      rel = null;
    } else if (rel) {
      rel.lines.push(line);
    }
  }
  for (const c of Object.values(components)) {
    for (const r of c.releases) r.body = r.lines.join('\n').trim();
  }
  return components;
}

const cmp = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

export function check(components, readFile = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')) {
  const problems = [];
  if (!Object.keys(components).length) problems.push('no component sections (## <slug> — <title>)');
  for (const c of Object.values(components)) {
    const at = (msg) => problems.push(`${c.slug}: ${msg}`);
    c.problems.forEach(at);
    const [first, ...rest] = c.releases;
    if (!first || first.version !== 'Unreleased') at('first release heading must be ### [Unreleased]');
    const released = first?.version === 'Unreleased' ? rest : c.releases;
    for (const r of released) {
      if (r.version === 'Unreleased') at('### [Unreleased] appears twice');
      else if (!r.date) at(`[${r.version}] has no date (### [x.y.z] - YYYY-MM-DD)`);
      if (r.version !== 'Unreleased' && !r.body) at(`[${r.version}] has no entries`);
    }
    for (const r of c.releases) {
      for (const l of r.lines) {
        const t = TYPE.exec(l);
        if (t && !TYPES.includes(t[1])) at(`[${r.version}] unknown change type "#### ${t[1]}" (use ${TYPES.join(', ')})`);
      }
    }
    const versions = released.filter((r) => r.version !== 'Unreleased');
    for (let i = 1; i < versions.length; i++) {
      if (cmp(versions[i - 1].version, versions[i].version) <= 0) {
        at(`versions not newest-first: ${versions[i - 1].version} before ${versions[i].version}`);
      }
      if (versions[i - 1].date < versions[i].date) at(`dates go backwards at ${versions[i - 1].version}`);
    }
    const vf = VERSION_FILES[c.slug];
    if (vf) {
      const v = readFile(vf).trim();
      const latest = versions[0]?.version;
      if (v !== latest) at(`${vf} says ${v} but the newest release in CHANGELOG.md is ${latest ?? 'none'}`);
    }
  }
  for (const slug of Object.keys(VERSION_FILES)) {
    if (!components[slug]) problems.push(`${slug}: has a version file but no CHANGELOG.md section`);
  }
  return problems;
}

export function latest(c) {
  return c.releases.find((r) => r.version !== 'Unreleased') ?? null;
}

export function pending(c) {
  const u = c.releases.find((r) => r.version === 'Unreleased');
  return u && u.body ? u.body : '';
}

// TradingView's "Publish update" box is plain text: no headings, links or emphasis.
export function toTradingView(body) {
  return body
    .replace(/\n[ \t]+(?![-*] )(?=\S)/g, ' ') // the box hard-wraps nothing: rejoin wrapped bullets
    .split('\n')
    .map((l) => l
      .replace(/^#### (.+)$/, '$1:')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^(\s*)\* /, '$1- '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function notes(components, slug, version, format = 'md') {
  const c = components[slug];
  if (!c) throw new Error(`unknown component "${slug}" (have: ${Object.keys(components).join(', ')})`);
  const r = version ? c.releases.find((x) => x.version === version) : latest(c);
  if (!r) throw new Error(`${slug}: no release ${version ?? '(none released yet)'}`);
  if (!r.body) throw new Error(`${slug}: [${r.version}] has no entries`);
  if (format === 'tradingview') return `${c.title} ${r.version}\n\n${toTradingView(r.body)}\n`;
  if (format !== 'md') throw new Error(`unknown format "${format}" (md or tradingview)`);
  return `${r.body}\n`;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const components = parse(fs.readFileSync(CHANGELOG, 'utf8'));
  if (cmd === 'check') {
    const problems = check(components);
    if (problems.length) {
      console.error(problems.map((p) => `✗ ${p}`).join('\n'));
      return 1;
    }
    console.log(`✓ CHANGELOG.md: ${Object.keys(components).length} components, all consistent`);
    return 0;
  }
  if (cmd === 'status') {
    for (const c of Object.values(components)) {
      const l = latest(c);
      const p = pending(c);
      const n = p.split('\n').filter((x) => /^\s*[-*] /.test(x)).length;
      console.log(`${c.slug.padEnd(10)} ${(l ? `${l.version} (${l.date})` : 'unreleased').padEnd(20)} ${n ? `${n} pending entr${n === 1 ? 'y' : 'ies'}` : 'nothing pending'}`);
    }
    return 0;
  }
  if (cmd === 'notes') {
    const fi = rest.indexOf('--format');
    const format = fi >= 0 ? rest[fi + 1] : 'md';
    const pos = rest.filter((_, i) => fi < 0 || (i !== fi && i !== fi + 1));
    process.stdout.write(notes(components, pos[0], pos[1], format));
    return 0;
  }
  console.error('usage: changelog.mjs check | status | notes <slug> [version] [--format md|tradingview]');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exitCode = 1;
  }
}
