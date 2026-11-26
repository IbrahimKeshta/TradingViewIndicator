// Pine v6 named colours as hex, and Pine's color.new(c, transp).
// Values are Pine's published palette; Task 9 confirms them against a live TradingView chart.
export const PINE_COLORS = Object.freeze({
  aqua: '#00BCD4',
  black: '#363A45',
  blue: '#2962FF',
  fuchsia: '#E040FB',
  gray: '#787B86',
  green: '#4CAF50',
  lime: '#00E676',
  maroon: '#880E4F',
  navy: '#311B92',
  olive: '#808000',
  orange: '#FF9800',
  purple: '#9C27B0',
  red: '#F23645',
  silver: '#B2B5BE',
  teal: '#089981',
  white: '#FFFFFF',
  yellow: '#FDD835',
});

// color.new(c, transp): `c` is a #RGB / #RRGGBB hex; transp is 0 (opaque) .. 100 (invisible).
export function colorNew(c, transp) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (!m) throw new Error(`colorNew expects a #RGB or #RRGGBB colour, got ${c}`);
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = Math.round((1 - transp / 100) * 1e4) / 1e4;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
