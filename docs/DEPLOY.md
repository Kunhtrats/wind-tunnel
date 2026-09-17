# Setup Instructions for GitHub Pages

## For kunhtrats.github.io/projects/wind-tunnel/

### Option 1: Subdirectory in main portfolio repo
1. Clone your main portfolio repo: `kunhtrats.github.io`
2. Create directory: `projects/wind-tunnel/`
3. Copy these files into it:
   - index.html
   - style.css
   - main.js
   - worker.js
   - solver.mjs
   - wasm-solver.mjs
   - engine.mjs
   - engine.wasm
4. Commit and push
5. Access at: https://kunhtrats.github.io/projects/wind-tunnel/

### Option 2: GitHub Pages from this repo
1. Go to repo Settings → Pages
2. Source: Deploy from branch → main
3. Access at: https://kunhtrats.github.io/wind-tunnel/

## Files needed for deployment
```
index.html
style.css
main.js
worker.js
solver.mjs
wasm-solver.mjs
engine.mjs
engine.wasm
```

## Notes
- All paths use relative `./` prefix for subdirectory compatibility
- Requires HTTP server (GitHub Pages provides this)
- No server-side code needed
- WASM files served automatically by GitHub Pages
