# Quick Start

The app requires a local HTTP server (file:// won't work due to WebAssembly security).

## Run the app

```cmd
start.cmd
```

This will:
1. Start a local server on http://localhost:8000
2. Open the app in your browser

Press Ctrl+C in the command window to stop the server.

## What was optimized

### Performance improvements:
- **Inlined equilibrium function** in C++ solver - eliminates function call overhead in hot loop
- **Cached velocity squared** calculation - computed once per cell instead of 9 times
- **Optimized collision step** - expanded equilibrium inline in BGK collision loop
- **Improved heat transport** - added stability factor and boundary checks
- **Better inlet boundary** - uses proper equilibrium distribution
- **Optimized JS rendering** - bitwise ops instead of Math.round, factored divisions
- **Faster bilinear interpolation** - reduced multiplications in sample()
- **Streamlined palette** - simpler lerp calculation

### Aerodynamic realism improvements:
- **Enhanced boundary conditions** - inlet uses full equilibrium distribution for better flow development
- **Stable heat transport** - added subcycling factor to prevent temperature oscillations
- **Boundary safety** - prevents array access errors at domain edges

## Rebuild WASM (if you have Emscripten)

```cmd
call D:\Developer\emsdk\emsdk_env.bat
build.cmd
```

The optimized C++ code will compile to faster WebAssembly.
