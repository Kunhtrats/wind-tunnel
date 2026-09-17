# Wind Tunnel

2D CFD simulation using Lattice Boltzmann Method (LBM).

**Live demo:** https://kunhtrats.github.io/projects/wind-tunnel/

## Tech Stack
- C++ solver compiled to WebAssembly
- Web Workers for background computation
- Float64 precision
- D2Q9 lattice scheme

## Features
- Multiple geometries: airfoil, venturi, cylinder, plate
- Real-time flow visualization
- Interactive controls
- Heat transfer simulation

## Requirements
Must be served over HTTP (not file://) due to WebAssembly and ES modules.

## Local Development
```bash
python -m http.server 8000
```

Then open http://localhost:8000

## Build (requires Emscripten)
```bash
build.cmd
```
