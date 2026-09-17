// UI utilities only; all simulation physics lives in solver.cpp.
export function speedToKmh(speed, metres, seconds) {
  if (![speed, metres, seconds].every(Number.isFinite) || metres <= 0 || seconds <= 0) throw new Error('Physical scales must be positive and finite.');
  return speed * metres / seconds * 3.6;
}
// Supersampled visual outline; tests compare it with the C++ collision geometry.
export function bodyAt(X, Y, shape, angle) {
  const a = angle * Math.PI / 180, dx = X - 0.72, dy = Y - 0.5;
  const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
  if (shape === 'cylinder') return dx * dx + dy * dy < 0.125 ** 2;
  if (shape === 'plate') return Math.abs(rx) < 0.16 && Math.abs(ry) < 0.018;
  if (shape === 'airfoil') {
    const t = (rx + 0.22) / 0.44;
    return t >= 0 && t <= 1 && Math.abs(ry) <= 5 * 0.18 * 0.44 * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t ** 2 + 0.2843 * t ** 3 - 0.1036 * t ** 4);
  }
  if (shape === 'venturi') {
    const neck = Math.abs(X - 0.95) < 0.65 ? 0.5 * (1 + Math.cos(Math.PI * (X - 0.95) / 0.65)) : 0;
    return Y < 0.08 + 0.23 * neck || Y > 0.92 - 0.23 * neck;
  }
  return shape === 'coanda' && ((X < 0.65 && Y >= 0.4) || ((X - 0.65) ** 2 + (Y - 0.65) ** 2 < 0.25 ** 2));
}