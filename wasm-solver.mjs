import createEngine from './engine.mjs';
export { speedToKmh } from './solver.mjs';
export const SHAPES = ['airfoil', 'venturi', 'coanda', 'cylinder', 'plate', 'empty'];

let engine = null;
let enginePromise = null;

async function getEngine() {
  if (engine) return engine;
  if (!enginePromise) enginePromise = createEngine();
  engine = await enginePromise;
  return engine;
}

function call(action) {
  try { return action(); }
  catch (error) {
    if (typeof error !== 'number') throw error;
    const [, message] = engine.getExceptionMessage(error);
    engine.decrementExceptionRefcount(error);
    throw new Error(message);
  }
}
function configuration({ width = 288, shape = 'airfoil', speed = 0.035, viscosity = 0.04, angle = 5, heat = 60, source = 'tunnel', fanX = 0.06, fanY = 0.5, direction = 0 } = {}) {
  if (![192, 288, 384, 576].includes(width) || !SHAPES.includes(shape) || !['fan', 'tunnel'].includes(source) || ![speed, viscosity, angle, heat, fanX, fanY, direction].every(Number.isFinite)) throw new Error('Invalid simulation parameters.');
  return { width, shape, speed, viscosity, angle, heat, source, fanX, fanY, direction };
}
function nativeConfig(c) { return { ...c, shape: SHAPES.indexOf(c.shape), source: c.source === 'fan' ? 1 : 0 }; }
export const equilibrium = async (q, rho, u, v) => { const eng = await getEngine(); return call(() => eng.equilibrium(q, rho, u, v)); };
export const bodyAt = async (x, y, shape, angle) => { const eng = await getEngine(); return eng.bodyAt(x, y, SHAPES.indexOf(shape), angle); };
export class Solver {
  constructor(config) {
    this.config = configuration(config);
    this.native = null;
    this.ready = this.init();
  }
  async init() {
    const eng = await getEngine();
    const c = this.config;
    this.native = call(() => new eng.Solver(nativeConfig(c)));
    Object.assign(this, c, { height: c.width / 2, n: c.width * c.width / 2 });
    return this;
  }
  update(config) {
    const c = configuration(config);
    call(() => this.native.update(nativeConfig(c)));
    Object.assign(this, c);
  }
  step() { call(() => this.native.step()); }
  inlet(y) { return this.native.inlet(y); }
  get steps() { return this.native.steps; }
  // Borrowed views: reacquire after stepping, updating, or allocating another solver.
  get f() { return this.native.view('f'); }
  get rho() { return this.native.view('rho'); }
  get u() { return this.native.view('u'); }
  get v() { return this.native.view('v'); }
  get temperature() { return this.native.view('temperature'); }
  get solid() { return this.native.view('solid'); }
  get wall() { return this.native.view('wall'); }
  snapshot() {
    const frame = this.native.snapshot();
    frame.fields = frame.fields.slice(); // Never detach WebAssembly memory.
    return frame;
  }
  dispose() { this.native.delete(); }
}