// Quick inline test - paste this in browser console (F12) to see what's failing:
(async () => {
  try {
    console.log('1. Testing WASM import...');
    const mod = await import('./wasm-solver.mjs');
    console.log('2. WASM module loaded:', mod);
    
    console.log('3. Creating Solver...');
    const solver = new mod.Solver({
      width: 192, shape: 'airfoil', speed: 0.035, viscosity: 0.04, 
      angle: 5, heat: 60, source: 'tunnel', fanX: 0.06, fanY: 0.5, direction: 0
    });
    console.log('4. Solver created:', solver.width, 'x', solver.height);
    
    solver.step();
    console.log('5. Step completed, steps:', solver.steps);
    
    const snap = solver.snapshot();
    console.log('6. Snapshot:', snap);
    
    solver.dispose();
    console.log('7. SUCCESS - WASM is working!');
  } catch(e) {
    console.error('ERROR:', e.message);
    console.error('Stack:', e.stack);
  }
})();
