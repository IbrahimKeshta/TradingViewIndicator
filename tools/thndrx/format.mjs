// Number formatting that matches Pine's output.

// Pine format.mintick: as many decimals as the symbol's mintick has (0.01 -> 2, 0.25 -> 2, 1 -> 0).
export function fmtPrice(x, mintick) {
  if (!Number.isFinite(x)) return 'NaN';
  const decimals = Math.min(10, Math.max(0, (mintick.toFixed(10).replace(/0+$/, '').split('.')[1] ?? '').length));
  return x.toFixed(decimals);
}

// Pine str.tostring(x, pattern) for the four patterns the indicator uses.
export function fmtNum(x, pattern) {
  if (!Number.isFinite(x)) return 'NaN';
  switch (pattern) {
    case '0': return x.toFixed(0);
    case '0.0': return x.toFixed(1);
    case '0.00': return x.toFixed(2);
    case '#.##': return String(Number(x.toFixed(2))); // drops trailing zeros; "-0" prints as "0"
    default: throw new Error(`unsupported number pattern ${pattern}`);
  }
}
