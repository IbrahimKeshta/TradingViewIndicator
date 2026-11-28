// node --test tools/release/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse, check, notes, pending, latest, toTradingView, CHANGELOG } from './changelog.mjs';

const GOOD = `# Changelog

## How this file works

Prose that is not a component.

## ict — ICT + RSI/MA Confluence

### [Unreleased]

#### Added

- A new \`Foo\` input.

### [1.1.0] - 2026-11-28

#### Fixed

- **Behaviour change:** stops now [respect](README.md#x) the floor.

### [1.0.0] - 2026-11-26

#### Added

- First release.

## thndrx — ThndrX userscripts

### [Unreleased]

### [0.2.0] - 2026-11-26

#### Added

- SOF overlay.
`;

const files = (v) => () => v;

test('parses components, releases and pending entries', () => {
  const c = parse(GOOD);
  assert.deepEqual(Object.keys(c), ['ict', 'thndrx']);
  assert.equal(c.ict.title, 'ICT + RSI/MA Confluence');
  assert.deepEqual(c.ict.releases.map((r) => r.version), ['Unreleased', '1.1.0', '1.0.0']);
  assert.equal(latest(c.ict).version, '1.1.0');
  assert.match(pending(c.ict), /new `Foo` input/);
  assert.equal(pending(c.thndrx), '');
});

test('a consistent changelog has no problems', () => {
  assert.deepEqual(check(parse(GOOD), files('0.2.0\n')), []);
});

test('catches a version file that disagrees with the newest release', () => {
  const p = check(parse(GOOD), files('0.3.0'));
  assert.equal(p.length, 1);
  assert.match(p[0], /tools\/thndrx\/VERSION says 0\.3\.0 but the newest release in CHANGELOG\.md is 0\.2\.0/);
});

test('catches missing Unreleased, missing date, wrong order and unknown type', () => {
  const bad = GOOD
    .replace('### [Unreleased]\n\n#### Added', '#### Added')
    .replace('### [1.0.0] - 2026-11-26', '### [1.2.0]')
    .replace('#### Fixed', '#### Improved');
  const p = check(parse(bad), files('0.2.0')).join('\n');
  assert.match(p, /ict: first release heading must be ### \[Unreleased\]/);
  assert.match(p, /ict: \[1\.2\.0\] has no date/);
  assert.match(p, /ict: versions not newest-first: 1\.1\.0 before 1\.2\.0/);
  assert.match(p, /ict: \[1\.1\.0\] unknown change type "#### Improved"/);
});

test('catches a malformed release heading', () => {
  const p = check(parse(GOOD.replace('### [1.0.0] - 2026-11-26', '### 1.0.0')), files('0.2.0'));
  assert.ok(p.some((x) => /bad release heading: ### 1\.0\.0/.test(x)));
});

test('notes: latest by default, a named version, and the TradingView plain-text form', () => {
  const c = parse(GOOD);
  assert.match(notes(c, 'ict'), /^#### Fixed/);
  assert.match(notes(c, 'ict', '1.0.0'), /First release/);
  const tv = notes(c, 'ict', undefined, 'tradingview');
  assert.equal(tv, 'ICT + RSI/MA Confluence 1.1.0\n\nFixed:\n\n- Behaviour change: stops now respect the floor.\n');
  assert.throws(() => notes(c, 'nope'), /unknown component/);
  assert.throws(() => notes(c, 'ict', '9.9.9'), /no release 9\.9\.9/);
});

test('toTradingView strips markdown it cannot render', () => {
  assert.equal(toTradingView('* `a` and [b](c) **d**'), '- a and b d');
  assert.equal(toTradingView('- one long\n  bullet\n- two'), '- one long bullet\n- two');
});

test('the real CHANGELOG.md passes its own check', () => {
  const problems = check(parse(fs.readFileSync(CHANGELOG, 'utf8')));
  assert.deepEqual(problems, []);
});
