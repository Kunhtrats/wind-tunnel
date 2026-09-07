import { Solver } from './solver.mjs';
let solver;
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      solver = new Solver(data.config);
      self.postMessage({ type: 'ready', id: data.id, width: solver.width, height: solver.height, solid: solver.solid });
    } else if (!solver || !['step', 'update'].includes(data.type)) throw new Error('Invalid solver request.');
    if (data.type === 'update') {
      solver.update(data.config);
      self.postMessage({ type: 'geometry', id: data.id, solid: solver.solid, config: data.config });
    }
    const start = performance.now();
    if (data.type === 'step') {
      if (!Number.isFinite(data.budget) || data.budget < 4 || data.budget > 100) throw new Error('Invalid playback budget.');
      do { solver.step(); } while (performance.now() - start < data.budget);
    }
    const frame = solver.snapshot();
    self.postMessage({ type: 'frame', id: data.id, ...frame }, [frame.fields.buffer]);
  } catch (error) { self.postMessage({ type: 'error', id: data.id, message: error.message }); }
};