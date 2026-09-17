import assert from 'node:assert/strict';
import { Solver, SHAPES, equilibrium, speedToKmh, bodyAt } from './wasm-solver.mjs';
import { bodyAt as outlineAt } from './solver.mjs';
const eq = Array.from({ length: 9 }, (_, q) => equilibrium(q, 1.1, 0.03, -0.01));
assert.ok(Math.abs(eq.reduce((a, b) => a + b, 0) - 1.1) < 1e-12, 'equilibrium conserves density');
assert.ok(Math.abs(eq[1] - eq[3] + eq[5] - eq[6] - eq[7] + eq[8] - 1.1 * 0.03) < 1e-12, 'equilibrium conserves momentum');
assert.throws(() => new Solver({ speed: NaN })); assert.throws(() => new Solver({ width: 200 }));
const rest = new Solver({ width: 192, shape: 'empty', speed: 0, heat: 20 });
for (let t = 0; t < 50; t++) rest.step();
assert.ok(rest.u.every(u => Math.abs(u) < 1e-13), 'rest remains at rest');
assert.ok(rest.rho.every(r => Math.abs(r - 1) < 1e-12), 'rest preserves mass');
assert.ok(rest.temperature.every(t => t === 20), 'uniform temperature preserved');
assert.ok(rest.f instanceof Float64Array, 'physics uses double precision');
assert.ok(rest.snapshot().fields instanceof Float64Array, 'field transfer preserves double precision');
rest.dispose();
for (const shape of SHAPES) {
  const s = new Solver({ width: 192, shape });
  for (let y = 1; y < s.height - 1; y++) for (let x = 0; x < s.width; x++) {
    assert.equal(bodyAt(x / s.height, y / s.height, shape, 5), outlineAt(x / s.height, y / s.height, shape, 5), `${shape}: UI and C++ geometry agree`);
  }
  for (let t = 0; t < 600; t++) s.step();
  const snapshot = s.snapshot();
  assert.ok(snapshot.fields.every(Number.isFinite), `${shape}: finite fields`);
  assert.ok(s.temperature.every(t => t >= 19.999 && t <= 60.001), `${shape}: thermal maximum principle`);
  assert.ok(s.u.every((u, i) => !s.solid[i] || u === 0), `${shape}: stationary solids`);
  assert.ok(snapshot.maxSpeed > 0, `${shape}: nonzero flow`);
  for (let y = 1; y < s.height - 1; y++) if (!s.solid[y * s.width]) assert.ok(Math.abs(s.u[y * s.width] - s.inlet(y)) < 1e-6, `${shape}: velocity inlet`);
  if (shape === 'venturi') {
    const center = Math.floor(s.height / 2) * s.width;
    assert.ok(s.u[center + Math.round(s.height * 0.95)] > s.u[center + 3], 'Venturi throat accelerates flow');
  }
  console.log(`${shape}: 600 steps, Re=${snapshot.reynolds.toFixed(1)}, max speed=${snapshot.maxSpeed.toFixed(4)}`);
  s.dispose();
}
assert.equal(speedToKmh(0.05, 0.01, 0.0001), 18);
assert.throws(() => speedToKmh(1, 0, 1));
assert.throws(() => new Solver({ fanX: NaN }));
assert.throws(() => new Solver({ direction: 181 }), /Invalid simulation parameters/);
const ultra = new Solver({ width: 576 });
assert.equal(ultra.height, 288); ultra.dispose();
for (const direction of [0, 90, -90, 180]) {
  const fan = new Solver({ width: 192, shape: 'empty', source: 'fan', direction, fanX: 0.5, speed: 0.09 });
  for (let t = 0; t < 120; t++) fan.step();
  const i = Math.round(fan.width * 0.5) + Math.round(fan.height * 0.5) * fan.width;
  const a = direction * Math.PI / 180;
  assert.ok(fan.u[i] * Math.cos(a) + fan.v[i] * Math.sin(a) > 0.005, `fan accelerates toward ${direction}°`);
  assert.ok(fan.snapshot().fields.every(Number.isFinite));
  fan.dispose();
}
const liveConfig = { width: 192, shape: 'airfoil', source: 'fan', speed: 0.055, angle: 5 };
const live = new Solver(liveConfig);
for (let t = 0; t < 80; t++) live.step();
const saved = live.f.slice(), oldMask = live.solid.slice();
live.update({ ...liveConfig, angle: 15, heat: 90, direction: 30 });
assert.equal(live.steps, 80, 'live update preserves simulation time');
let changed = 0;
for (let i = 0; i < live.n; i++) {
  if (live.solid[i] !== oldMask[i]) changed++;
  else for (let q = 0; q < 9; q++) assert.equal(live.f[i * 9 + q], saved[i * 9 + q], 'unchanged cells preserve populations');
  if (!live.wall[i]) assert.equal(Boolean(live.solid[i]), bodyAt((i % live.width) / live.height, Math.floor(i / live.width) / live.height, 'airfoil', 15), 'render and solver share geometry');
}
assert.ok(changed > 0, 'incidence changes geometry');
assert.throws(() => live.update({ ...liveConfig, speed: 1 }), /Invalid simulation parameters/);
assert.equal(live.angle, 15, 'invalid update leaves state intact');
for (let t = 0; t < 300; t++) live.step();
assert.ok(live.snapshot().fields.every(Number.isFinite), 'live geometry remains stable');
live.update({ ...liveConfig, angle: -15, fanX: 0.8, fanY: 0.3, direction: 180, viscosity: 0.12, heat: 0 });
for (let t = 0; t < 200; t++) live.step();
assert.ok(live.temperature.every(t => t >= -0.001 && t <= 90.001), 'live cooling stays bounded');
console.log('Fan directions, higher speed, live edits, geometry and unit conversion passed.');
live.dispose();
const messages = [];
globalThis.self = { postMessage: (message, transfer = []) => messages.push(structuredClone(message, { transfer })) };
await import('./worker.js');
self.onmessage({ data: { type: 'init', id: 7, config: liveConfig } });
assert.equal(messages.at(-1).type, 'frame');
self.onmessage({ data: { type: 'step', id: 7, budget: 12 } });
const workerSteps = messages.at(-1).steps;
assert.ok(workerSteps > 0);
self.onmessage({ data: { type: 'step', id: 7, budget: 12 } });
assert.ok(messages.at(-1).steps > workerSteps, 'snapshot transfer leaves WASM memory intact');
const updatedSteps = messages.at(-1).steps;
self.onmessage({ data: { type: 'update', id: 7, config: { ...liveConfig, angle: 10 } } });
assert.equal(messages.at(-2).type, 'geometry');
assert.equal(messages.at(-1).steps, updatedSteps, 'worker live update preserves time');
self.onmessage({ data: { type: 'step', id: 7, budget: Infinity } });
assert.equal(messages.at(-1).type, 'error', 'worker rejects invalid compute budget');
self.onmessage({ data: null });
assert.equal(messages.at(-1).type, 'error', 'worker rejects malformed requests');
delete globalThis.self;
console.log('Worker initialization, stepping, live updates and validation passed.');
console.log('All numerical smoke checks passed (not engineering validation).');