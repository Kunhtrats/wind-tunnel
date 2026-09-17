// Test if worker can even start
console.log('[SimpleWorker] Worker file loaded and executing!');
self.postMessage({ type: 'loaded', message: 'Worker script executed' });
