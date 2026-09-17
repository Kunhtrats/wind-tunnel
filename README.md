# 🌪️ Wind Tunnel

> 2D Computational Fluid Dynamics simulation using Lattice Boltzmann Method

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen?style=flat-square)](https://kunhtrats.github.io/projects/wind-tunnel/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Language: C++](https://img.shields.io/badge/C++-17-00599C?style=flat-square&logo=c%2B%2B)](src/solver.cpp)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-654FF0?style=flat-square&logo=webassembly&logoColor=white)](engine.wasm)

**[🚀 Live Demo](https://kunhtrats.github.io/projects/wind-tunnel/)** • **[📖 Documentation](docs/)** • **[🐛 Report Bug](../../issues)**

---

## ✨ Features

- 🔬 **Real-time CFD**: D2Q9 Lattice Boltzmann solver in C++/WASM
- 🎨 **Interactive visualization**: Flow fields, pressure maps, heat transfer
- ⚙️ **Multiple geometries**: Airfoil, venturi, cylinder, flat plate, Coandă effect
- 🖥️ **Web Workers**: Non-blocking simulation in background thread
- 📊 **Float64 precision**: High-accuracy double-precision computation
- 🎮 **Live controls**: Adjust speed, viscosity, angle, resolution on-the-fly

## 🚀 Quick Start

### Run Locally

```bash
# Clone the repository
git clone https://github.com/Kunhtrats/wind-tunnel.git
cd wind-tunnel

# Serve with any HTTP server (required for WASM/ES modules)
python -m http.server 8000
# or
npx serve

# Open http://localhost:8000
```

> ⚠️ **Important**: Must be served over HTTP, not `file://` protocol

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| **Solver** | C++17, Lattice Boltzmann Method (LBM) |
| **Build** | Emscripten 4.0.15+ |
| **Frontend** | Vanilla JavaScript (ES modules) |
| **Graphics** | HTML5 Canvas 2D |
| **Threading** | Web Workers API |
| **Precision** | IEEE 754 float64 |

## 📁 Project Structure

```
wind-tunnel/
├── index.html              # Main entry point
├── style.css               # Minimal dark UI
├── engine.wasm             # Compiled C++ solver
├── engine.mjs              # WASM JavaScript bindings
├── src/
│   ├── solver.cpp          # C++ LBM implementation
│   ├── wasm-solver.mjs     # WASM wrapper
│   ├── worker.js           # Web Worker logic
│   ├── main.js             # UI controller
│   ├── solver.mjs          # Geometry utilities
│   └── build.cmd           # Compilation script
├── tests/                  # Test files
└── docs/                   # Documentation
```

## 🔧 Build from Source

Requires [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html):

```bash
# Install Emscripten
emsdk install 4.0.15
emsdk activate 4.0.15

# Build
cd src
build.cmd  # Windows
# or manually:
em++ solver.cpp -o ../engine.mjs \
  -std=c++17 -O3 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web,worker \
  -s ALLOW_MEMORY_GROWTH=1 \
  --bind

# Test
cd ..
node tests/solver.test.mjs
```

## 🎯 Physics

### Lattice Boltzmann Method (D2Q9)
- **Scheme**: BGK collision operator, single relaxation time (SRT)
- **Lattice**: 9-velocity 2D grid
- **Boundaries**: No-slip bounce-back walls
- **Inlet/Outlet**: Velocity inlet + extrapolated outlet
- **Heat transfer**: Passive scalar advection-diffusion (α = ν/0.71)

### Equations

**Navier-Stokes approximation:**
```
∂ρ/∂t + ∇·(ρu) = 0
∂u/∂t + u·∇u = −∇p/ρ + ν∇²u
p = ρ/3; ν = (τ − ½)/3
```

**Heat equation:**
```
∂T/∂t + u·∇T = α∇²T
```

> ⚠️ **Note**: Educational low-Mach laminar model. Not calibrated for engineering use.

## 🎨 Usage

1. **Select geometry** from dropdown
2. **Adjust parameters**: speed, viscosity, angle
3. **Change view**: Flow, Natural, Heat, Pressure
4. **Move fan** (fan mode only)
5. **Hover canvas** to inspect velocity/pressure/temperature

## 📜 License

**MIT License**

Copyright (c) 2026 Kunhtrats

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## 🤝 Contributing

Contributions welcome! Feel free to:
- 🐛 Report bugs via [Issues](../../issues)
- 💡 Suggest features
- 🔧 Submit pull requests

## 📬 Contact

**Kunhtrats** • [GitHub](https://github.com/Kunhtrats)

---

<div align="center">
  Made with 💻 and ☕ • Star ⭐ if you like it!
</div>

