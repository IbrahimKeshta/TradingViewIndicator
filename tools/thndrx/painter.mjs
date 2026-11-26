// Painter: turns a RenderPlan into TradingView drawing-API calls and keeps the chart in sync with it by diffing.
// It talks to a ChartPort, never to ThndrX directly, so tests run on a fake port:
//   ChartPort = { createShape(point, options): Promise<id>, createMultipointShape(points, options): Promise<id>,
//                 removeEntity(id, { disableUndo }): void }
// Shape names and override keys come from the live recon (docs/superpowers/plans/2026-11-24-thndrx-recon.md).
// Every drawing is created unsaved (never reaches Thndr's servers) and the painter removes only ids it created.

export const MAX_BANDS = 300;       // R17: killzone bands can number thousands on intraday charts; draw the newest only
const BATCH_SIZE = 250;             // creations issued together before the stale check runs again (R18)
const LINE_STYLE = { solid: 0, dotted: 1, dashed: 2 };
const FONT_SIZE = { tiny: 10, small: 12 };
const SAFE = Object.freeze({ disableSave: true, disableUndo: true, lock: true, disableSelection: true });

// Draw order, back to front, so later kinds sit on top (Pine paints bands/fills under boxes, labels on top).
const KINDS = [['bands', 'band'], ['fills', 'fill'], ['boxes', 'box'], ['series', 'series'], ['lines', 'line'], ['labels', 'label'], ['markers', 'marker']];

const opts = (shape, overrides, extra = {}) => ({ shape, overrides, ...extra, ...SAFE });

// Maps one plan item to one chart call, or null when Pine would draw nothing (runs too short to be a line or polygon).
// `meta` is plan.meta: bands need its price range (fixed per load by the caller; see desiredItems). Returns { multi, points, options }.
export function toShapeCalls(item, kind, meta) {
  switch (kind) {
    case 'box': {
      // Optional Pine box text (Session Order Flow's session and pool boxes): rectangles take `text` plus label
      // overrides on the v31 library (checked live 2026-11-26). Boxes without text keep the plain call.
      const overrides = { color: item.border, backgroundColor: item.bg, fillBackground: true, linewidth: 1 };
      if (item.dashed) overrides.linestyle = LINE_STYLE.dashed;
      const extra = {};
      if (item.text) {
        Object.assign(overrides, {
          showLabel: true, textColor: item.textColor, fontSize: FONT_SIZE[item.textSize] ?? FONT_SIZE.tiny,
          horzLabelsAlign: item.hAlign ?? 'center', vertLabelsAlign: item.vAlign ?? 'middle',
        });
        extra.text = item.text;
      }
      return {
        multi: true,
        points: [{ time: item.t1, price: item.top }, { time: item.t2, price: item.bottom }],
        options: opts('rectangle', overrides, extra),
      };
    }
    case 'line':
      return {
        multi: true,
        points: [{ time: item.t1, price: item.p1 }, { time: item.t2, price: item.p2 }],
        options: opts('trend_line', { linecolor: item.color, linewidth: item.width, linestyle: LINE_STYLE[item.style] ?? 0, extendRight: item.extendRight === true }),
      };
    case 'label':
      return {
        multi: false,
        points: [{ time: item.time, price: item.price }],
        options: opts('text', {
          color: item.textColor, backgroundColor: item.color, fillBackground: true, fontsize: FONT_SIZE[item.size] ?? FONT_SIZE.tiny,
        }, { text: item.text }),
      };
    case 'series':
      if (item.points.length < 2) return null;
      return {
        multi: true,
        points: item.points.map((p) => ({ time: p.time, price: p.price })),
        options: opts('path', { lineColor: item.color, lineWidth: item.width, lineStyle: 0, leftEnd: 0, rightEnd: 0 }),
      };
    case 'fill':
      if (item.points.length < 3) return null;
      return {
        multi: true,
        points: item.points.map((p) => ({ time: p.time, price: p.price })),
        options: opts('polyline', { linecolor: item.color, linewidth: 1, backgroundColor: item.color, fillBackground: true, filled: true }),
      };
    case 'marker': {
      const up = item.shape === 'triangleup';
      return {
        multi: false,
        points: [{ time: item.time, price: item.price }],
        options: opts(up ? 'arrow_up' : 'arrow_down', { arrowColor: item.color, color: item.color }),
      };
    }
    case 'band': {
      if (!meta || !Number.isFinite(meta.priceLow) || !Number.isFinite(meta.priceHigh)) return null;
      return {
        multi: true,
        points: [{ time: item.t1, price: meta.priceLow * 0.5 }, { time: item.t2, price: meta.priceHigh * 2 }],
        options: opts('rectangle', { color: item.color, backgroundColor: item.color, fillBackground: true, linewidth: 0 }),
      };
    }
    default:
      throw new Error(`unknown plan item kind ${kind}`);
  }
}

// JSON with sorted object keys, so equal items always serialise equally whatever their field order.
function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

// cyrb53: 53-bit string hash. Collisions are negligible at ~1000 items and a miss only means one needless redraw.
function hashString(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Hash of everything that is drawn: all fields but `order` (creation order never changes the picture).
export function itemHash(item) {
  const { order, ...drawn } = item; // eslint-disable-line no-unused-vars
  return hashString(stableStringify(drawn));
}

// The items a plan wants on screen, keyed by "kind|key", in back-to-front order.
function desiredItems(plan) {
  const wanted = new Map();
  for (const [field, kind] of KINDS) {
    let items = plan[field] || [];
    if (kind === 'band') items = [...items].sort((a, b) => b.t1 - a.t1).slice(0, MAX_BANDS).reverse();
    else if (items.length && items[0].order !== undefined) items = [...items].sort((a, b) => a.order - b.order);
    const meta = kind === 'band' ? plan.meta : undefined;
    for (const item of items) {
      const call = toShapeCalls(item, kind, meta);
      if (!call) continue;
      // The band's price span is not in its hash: the caller fixes it per load (R25), so a new high or low on a live
      // bar does not redraw every band (each redraw is a removal, and any removal makes Thndr re-save drawings).
      wanted.set(`${kind}|${item.key}`, { call, hash: itemHash(item) });
    }
  }
  return wanted;
}

export class Painter {
  constructor(port) {
    this.port = port;
    this.token = 0;
    this.live = new Map(); // identity -> { id, hash }; only ids this painter created
  }

  // Starts a new generation: any apply still running with an older token stops and cleans up after itself.
  begin() { return ++this.token; }

  #remove(id) {
    try { this.port.removeEntity(id, { disableUndo: true }); } catch { /* already gone (symbol change, layout reset) */ }
  }

  async apply(plan, token) {
    if (token !== this.token) return 'stale';
    const wanted = desiredItems(plan);
    let removed = 0, kept = 0;
    for (const [identity, entry] of [...this.live]) {
      const want = wanted.get(identity);
      if (want && want.hash === entry.hash) { kept++; wanted.delete(identity); continue; }
      this.live.delete(identity);
      this.#remove(entry.id);
      removed++;
    }

    const mine = []; // everything this apply created, to discard if it turns stale
    const todo = [...wanted];
    let failed = 0;
    try {
      for (let i = 0; i < todo.length; i += BATCH_SIZE) {
        if (token !== this.token) { this.#discard(mine); return 'stale'; }
        const batch = todo.slice(i, i + BATCH_SIZE);
        // Issued without awaiting each call (R18); the calls still start in back-to-front order. The async wrapper turns
        // a synchronous throw from the port into a rejection (counted as failed), and records each id the moment its
        // call resolves, so `mine` is complete whatever happens to the rest of the apply.
        const results = await Promise.allSettled(batch.map(async ([identity, { call, hash }]) => {
          const id = await (call.multi
            ? this.port.createMultipointShape(call.points, call.options)
            : this.port.createShape(call.points[0], call.options));
          if (id == null) throw new Error('no id returned');
          mine.push({ identity, id, hash });
        }));
        failed += results.filter((r) => r.status === 'rejected').length;
        if (token !== this.token) { this.#discard(mine); return 'stale'; }
      }
    } catch (err) {
      this.#discard(mine); // anything unexpected: never leave unsaved, locked drawings behind
      throw err;
    }
    for (const m of mine) this.live.set(m.identity, { id: m.id, hash: m.hash });
    return { created: mine.length, removed, kept, failed };
  }

  #discard(created) {
    for (const m of created) this.#remove(m.id);
  }

  // Removes every drawing this painter made and invalidates any apply in flight (call begin() before applying again).
  async clear() {
    this.token++;
    for (const { id } of this.live.values()) this.#remove(id);
    this.live.clear();
  }
}
