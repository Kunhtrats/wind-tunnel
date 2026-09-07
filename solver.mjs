const CX = [0, 1, 0, -1, 0, 1, -1, -1, 1];
const CY = [0, 0, 1, 0, -1, 1, 1, -1, -1];
const OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6];
const W = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
export const SHAPES = ['airfoil', 'venturi', 'coanda', 'cylinder', 'plate', 'empty'];
export function speedToKmh(speed, metres, seconds) {
  if (![speed, metres, seconds].every(Number.isFinite) || metres <= 0 || seconds <= 0) throw new Error('Physical scales must be positive and finite.');
  return speed * metres / seconds * 3.6;
}
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
export function equilibrium(q, rho, u, v) {
  const cu = CX[q] * u + CY[q] * v;
  return W[q] * rho * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * (u * u + v * v));
}
export class Solver {
  constructor({ width = 288, shape = 'airfoil', speed = 0.035, viscosity = 0.04, angle = 5, heat = 60, source = 'tunnel', fanX = 0.06, fanY = 0.5, direction = 0 } = {}) {
    if (![192, 288, 384, 576].includes(width) || !SHAPES.includes(shape) || !['fan', 'tunnel'].includes(source) || ![speed, viscosity, angle, heat, fanX, fanY, direction].every(Number.isFinite) || speed < 0 || speed > 0.09 || viscosity < 0.02 || viscosity > 0.12 || Math.abs(angle) > 20 || heat < 0 || heat > 100 || fanX < 0.03 || fanX > 0.97 || fanY < 0.08 || fanY > 0.92 || Math.abs(direction) > 180) throw new Error('Invalid simulation parameters.');
    Object.assign(this, { width, height: width / 2, shape, speed, viscosity, angle, heat, source, fanX, fanY, direction, steps: 0 });
    const n = this.n = width * this.height;
    this.f = new Float32Array(n * 9); this.next = new Float32Array(n * 9);
    this.rho = new Float32Array(n).fill(1); this.u = new Float32Array(n); this.v = new Float32Array(n);
    this.temperature = new Float32Array(n).fill(20); this.nextTemperature = new Float32Array(n);
    this.solid = new Uint8Array(n); this.wall = new Uint8Array(n);
    const h = this.height;
    for (let y = 0; y < h; y++) for (let x = 0; x < width; x++) {
      const i = x + y * width, body = bodyAt(x / h, y / h, shape, angle);
      this.wall[i] = y === 0 || y === h - 1 ? 1 : 0;
      this.solid[i] = body || this.wall[i] ? 1 : 0;
      if (body && !this.wall[i]) this.temperature[i] = heat;
      const u = this.solid[i] ? 0 : this.inlet(y); this.u[i] = u;
      for (let q = 0; q < 9; q++) this.f[i * 9 + q] = equilibrium(q, 1, u, 0);
    }
    this.buildFan();
  }
  buildFan() {
    this.fan = [];
    const a = this.direction * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), h = this.height;
    this.fanU = c * this.speed; this.fanV = s * this.speed;
    if (this.source !== 'fan') return;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < this.width - 1; x++) {
      const dx = x - this.fanX * (this.width - 1), dy = y - this.fanY * (h - 1);
      const along = (dx * c + dy * s) / (h * 0.025), across = (-dx * s + dy * c) / (h * 0.09);
      if (Math.abs(along) < 1 && Math.abs(across) < 1 && !this.solid[x + y * this.width]) this.fan.push([x + y * this.width, 0.15 * (1 - along * along) * (1 - across * across)]);
    }
  }
  update(config) {
    // Validate the whole request before mutating the live field.
    const candidate = new Solver(config);
    if (candidate.width !== this.width || candidate.shape !== this.shape) throw new Error('Shape and resolution changes require reset.');
    const oldSolid = this.solid;
    // ponytail: re-equilibrate only changed cells; use conservative moving boundaries for quantitative pitching-wing loads.
    for (let i = 0; i < this.n; i++) {
      if (oldSolid[i] !== candidate.solid[i]) {
        let r = 0, ux = 0, vy = 0, temperature = 0, count = 0;
        for (const j of [i - 1, i + 1, i - this.width, i + this.width]) if (j >= 0 && j < this.n && !oldSolid[j] && !candidate.solid[j]) {
          r += this.rho[j]; ux += this.u[j]; vy += this.v[j]; temperature += this.temperature[j]; count++;
        }
        r = count ? r / count : 1; ux = count ? ux / count : 0; vy = count ? vy / count : 0;
        if (candidate.solid[i]) { ux = 0; vy = 0; }
        this.rho[i] = r; this.u[i] = ux; this.v[i] = vy;
        this.temperature[i] = count ? temperature / count : 20;
        for (let q = 0; q < 9; q++) this.f[i * 9 + q] = this.next[i * 9 + q] = equilibrium(q, r, ux, vy);
      }
      if (candidate.solid[i]) this.temperature[i] = candidate.wall[i] ? 20 : candidate.heat;
    }
    for (const key of ['speed', 'viscosity', 'angle', 'heat', 'source', 'fanX', 'fanY', 'direction', 'solid', 'fan', 'fanU', 'fanV']) this[key] = candidate[key];
  }
  inlet(y) {
    if (this.source === 'fan') return 0;
    if (this.shape !== 'coanda') return this.speed;
    const t = (y / this.height - 0.32) / 0.08;
    return t > 0 && t < 1 ? this.speed * 4 * t * (1 - t) : 0;
  }
  step() {
    const { width: w, height: h, n, f, next, solid, rho, u, v } = this;
    const omega = 1 / (0.5 + 3 * this.viscosity);
    // Local momentum actuator: relax velocity, preserving cell density (no mass injection).
    for (const [i, strength] of this.fan) {
      const ux = u[i] + strength * (this.fanU - u[i]), vy = v[i] + strength * (this.fanV - v[i]);
      for (let q = 0; q < 9; q++) f[i * 9 + q] += equilibrium(q, rho[i], ux, vy) - equilibrium(q, rho[i], u[i], v[i]);
      u[i] = ux; v[i] = vy;
    }
    // BGK collision, push streaming, halfway no-slip bounce-back.
    for (let i = 0; i < n; i++) {
      if (solid[i]) continue;
      const x = i % w, y = (i / w) | 0, base = i * 9;
      for (let q = 0; q < 9; q++) {
        const value = f[base + q] + omega * (equilibrium(q, rho[i], u[i], v[i]) - f[base + q]);
        const nx = x + CX[q], ny = y + CY[q], j = nx + ny * w;
        if (ny < 0 || ny >= h || (nx >= 0 && nx < w && solid[j])) next[base + OPP[q]] = value;
        else if (nx >= 0 && nx < w) next[j * 9 + q] = value;
      }
    }
    for (let y = 1; y < h - 1; y++) {
      const i = y * w, b = i * 9;
      if (!solid[i] && this.source === 'fan') {
        for (let q = 0; q < 9; q++) next[b + q] = next[b + 9 + q];
      } else if (!solid[i]) {
        // Zou/He inlet reconstructs the three incoming populations.
        const ux = this.inlet(y);
        const r = (next[b] + next[b + 2] + next[b + 4] + 2 * (next[b + 3] + next[b + 6] + next[b + 7])) / (1 - ux);
        next[b + 1] = next[b + 3] + 2 * r * ux / 3;
        next[b + 5] = next[b + 7] + (next[b + 4] - next[b + 2]) / 2 + r * ux / 6;
        next[b + 8] = next[b + 6] + (next[b + 2] - next[b + 4]) / 2 + r * ux / 6;
      }
      const out = i + w - 1;
      if (!solid[out]) for (let q = 0; q < 9; q++) next[out * 9 + q] = next[(out - 1) * 9 + q];
    }
    this.f = next; this.next = f;
    for (let i = 0; i < n; i++) {
      if (solid[i]) continue;
      let r = 0, ux = 0, vy = 0;
      for (let q = 0; q < 9; q++) { const value = next[i * 9 + q]; r += value; ux += value * CX[q]; vy += value * CY[q]; }
      ux /= r; vy /= r;
      if (!Number.isFinite(r + ux + vy) || r < 0.5 || r > 1.5 || ux * ux + vy * vy > 0.04) throw new Error('Low-Mach stability limit exceeded. Reduce speed or increase viscosity, then reset.');
      rho[i] = r; u[i] = ux; v[i] = vy;
    }
    // ponytail: first-order upwind heat transport is diffusive; upgrade for quantitative heat-transfer studies.
    const T = this.temperature, out = this.nextTemperature, alpha = this.viscosity / 0.71;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = x + y * w;
      if (solid[i]) { out[i] = this.wall[i] ? 20 : this.heat; continue; }
      if (x === 0) { out[i] = 20; continue; }
      const t = T[i], left = T[i - 1], right = T[x === w - 1 ? i : i + 1], top = T[i - w], bottom = T[i + w];
      out[i] = t - u[i] * (u[i] >= 0 ? t - left : right - t) - v[i] * (v[i] >= 0 ? t - top : bottom - t) + alpha * (left + right + top + bottom - 4 * t);
    }
    this.temperature = out; this.nextTemperature = T; this.steps++;
  }
  snapshot() {
    let reference = 0, count = 0, maxSpeed = 0;
    for (let y = 1; y < this.height - 1; y++) { const i = (y + 1) * this.width - 1; if (!this.solid[i]) { reference += this.rho[i]; count++; } }
    reference /= count || 1;
    const fields = new Float32Array(this.n * 4);
    for (let i = 0; i < this.n; i++) {
      fields[i * 4] = this.u[i]; fields[i * 4 + 1] = this.v[i]; fields[i * 4 + 2] = this.solid[i] ? 0 : (this.rho[i] - reference) / 3; fields[i * 4 + 3] = this.temperature[i];
      maxSpeed = Math.max(maxSpeed, Math.hypot(this.u[i], this.v[i]));
    }
    return { fields, steps: this.steps, maxSpeed, reynolds: this.speed * (this.height / 4) / this.viscosity };
  }
}