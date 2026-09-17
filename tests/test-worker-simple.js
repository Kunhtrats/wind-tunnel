// Minimal worker to test if basic worker loading works
console.log('Worker started!');
self.postMessage({ type: 'alive', message: 'Worker is running' });

self.onmessage = ({ data }) => {
  console.log('Worker received:', data);
  if (data.type === 'ping') {
    self.postMessage({ type: 'pong', message: 'Worker responding' });
  }
};
