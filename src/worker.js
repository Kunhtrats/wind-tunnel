import { Solver } from './src/wasm-solver.mjs';
let solver;

console.log('[Worker] Starting...');

self.onmessage = async ({ data }) => {
  console.log('[Worker] Received message:', data.type);
  try {
    if (!data || typeof data !== 'object') throw new Error('Invalid solver request.');
    if (data.type === 'init') {
      console.log('[Worker] Initializing solver...');
      const replacement = new Solver(data.config);
      console.log('[Worker] Waiting for solver to be ready...');
      await replacement.ready;
      console.log('[Worker] Solver ready:', replacement.width, 'x', replacement.height);
      solver?.dispose(); 
      solver = replacement;
      console.log('[Worker] Getting solid array...');
      const solidArray = solver.solid.slice();
      console.log('[Worker] Sending ready message...');
      self.postMessage({ type: 'ready', id: data.id, width: solver.width, height: solver.height, solid: solidArray });
      console.log('[Worker] Ready message sent');
      return;
    } else if (!solver || !['step', 'update'].includes(data.type)) throw new Error('Invalid solver request.');
    if (data.type === 'update') {
      solver.update(data.config);
      self.postMessage({ type: 'geometry', id: data.id, solid: solver.solid.slice(), config: data.config });
    }
    const start = performance.now();
    if (data.type === 'step') {
      if (!Number.isFinite(data.budget) || data.budget < 4 || data.budget > 100) throw new Error('Invalid playback budget.');
      do { solver.step(); } while (performance.now() - start < data.budget);
    }
    const frame = solver.snapshot();
    self.postMessage({ type: 'frame', id: data.id, ...frame }, [frame.fields.buffer]);
  } catch (error) { 
    console.error('[Worker] Error:', error.message, error.stack);
    self.postMessage({ type: 'error', id: data?.id, message: error.message }); 
  }
};

console.log('[Worker] Message handler installed');
