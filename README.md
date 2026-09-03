# Halo 3 loading screen (TypeScript + WebGPU)

Faithful browser port of the Halo 3 / Xbox 360 `default_logs.xex` loading screen
(CPU timing, geometry, RLE atlas, WGSL shaders).

## Requirements

- Chrome or Edge with WebGPU enabled
- Node.js 18+

## Run

```bash
npm install
npm run dev
```

## Deploy

Pushes to `main` build with Vite and publish to **GitHub Pages** via
`.github/workflows/pages.yml`. Enable Pages in the repo settings
(**Settings → Pages → Source: GitHub Actions**).

## HUD / URL

Controls stay hidden until the first ring build finishes (frac crosses 1 and the
join reveal +2s completes). After that, **Esc** toggles the menu. Settings are
mirrored in the query string:

| Param | Meaning |
|-------|---------|
| `egg=1` | Easter egg on |
| `loop=1` | Loop after ~3s |
| `freecam=1` | Freecam on |
| `load=30` | Simulated load seconds |
| `hud=1` | Show controls immediately |
| `hud=0` | Unlock after the ring, but keep the menu closed |
| `speed=4` | Freecam move speed |

Example: `?egg=1&loop=1&load=45&hud=1`

## Fidelity notes

Progress, camera tracks, stamp tent, egg scales, additive ring pass order, and
HSV composite `(0.5875, 0.65, 0.8333)` match the Xbox reference path. Final
composite applies an sRGB OETF for WebGPU canvas presentation. Oldframe / menu
grab is omitted.
