// Number formatting that matches Pine's output.

// Pine format.mintick: as many decimals as the symbol's mintick has (0.01 -> 2, 0.25 -> 2, 1 -> 0).
export function fmtPrice(x, mintick) {
  if (!Number.isFinite(x)) return 'NaN';
  const decimals = Math.min(10, Math.max(0, (mintick.toFixed(10).replace(/0+$/, '').split('.')[1] ?? '').length));
  return x.toFixed(decimals);
}

// Pine str.tostring(x, pattern) for the patterns the two indicators use.
export function fmtNum(x, pattern) {
  if (!Number.isFinite(x)) return 'NaN';
  switch (pattern) {
    case '0': return x.toFixed(0);
    case '0.0': return x.toFixed(1);
    case '0.00': return x.toFixed(2);
    case '#.##': return String(Number(x.toFixed(2))); // drops trailing zeros; "-0" prints as "0"
    case '#': return String(Number(x.toFixed(0)));
    case '#.#': case '0.#': return String(Number(x.toFixed(1)));
    default: throw new Error(`unsupported number pattern ${pattern}`);
  }
}

// Pine format.volume: K / M / B with at most two decimals, trailing zeros dropped (1847582 -> "1.85M", 500000 -> "500K").
export function fmtVolume(x) {
  if (!Number.isFinite(x)) return 'NaN';
  const a = Math.abs(x), sign = x < 0 ? '-' : '';
  const [div, unit] = a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, ''];
  return sign + String(Number((a / div).toFixed(2))) + unit;
}
