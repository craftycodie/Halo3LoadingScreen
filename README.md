![hero image](./hero.png)

### [View Loading Screen](https://craftycodie.github.io/Halo3LoadingScreen/)


# Halo 3 - Loading Screen 

This is a WebGPU port of the loading screen for Halo 3 on the Xbox 360 created with a focus on parity with the original game.

## How

Halo 3 Xbox 360 cache release_internal 11856.07.08.20.2332.release was used for reference.
I dumped shaders from the game, ran them through a decompiler and gave [Claude Fable](https://www.anthropic.com/claude/fable) access to the game's code via an [Hex-Rays IDA Pro](https://hex-rays.com/ida-pro) [MCP](https://github.com/mrexodia/ida-pro-mcp) as a means to perform static analysis of the game binary.
I used this to reimplement the loading screen within a Halo: The Master Chief Collection mod, and began reimplementing in WebGPU once this was near completion.
Throughout the process I compared the scene against the game running on actual hardware.

## Controls

The HUD stays locked until the first ring finishes, after that, **Esc** toggles the menu. Freecam: click the canvas for pointer lock, then WASD, Q/E, Shift, scroll for speed.

| Control | URL | Notes |
|---------|-----|--------|
| Egg | `egg=1` | Birthday message texture + camera pull-back |
| Loop | `loop=1` | Fade out and restart after ~3s |
| Pause | — | Freezes the load clock; freecam still moves |
| Freecam | `freecam=1` | Free look; `speed=4` sets move speed |
| HD | `hd=1` to enable | Off (default): 720p-tall ring like Xbox, upscaled. On: full canvas RT |
| Load seconds | `load=30` | Simulated load duration |
| Restart | — | Reset progress |
| HUD | `hud=1` / `hud=0` | Open immediately, or unlock without opening |

Example: `?egg=1&loop=1&load=45&hud=1`

## Export to Blender

Builds an animated scene — ring reveal, outline growth, guide cage, particles,
camera — plus a **GPU viewport** that runs the same Xbox shaders as the WebGPU
path (`src/shaders/loading.wgsl` → `src/shaders/loading.glsl` via Blender's
`GPUShaderCreateInfo`).

EEVEE node graphs stay as a lightweight preview. Fidelity is the GLSL draw
handler: float RT, additive ring / lines / points, then `ps_composite`.

```bash
npm run export:blender
```

Optional env: `LOAD_SECONDS=30`, `FPS=30`, `EGG=1`.

Output:

- `export/scene.json` — EEVEE meshes + frame keys + composite LUT
- `export/gpu/` — lattice VBOs, atlas textures, sim stamps, `loading.glsl`
- `export/halo3_loading_screen.blend` — if Blender is found

Without Blender on PATH:

```bash
blender -b -P tools/blender_import_loading_screen.py -- export/scene.json export/halo3_loading_screen.blend
```

Open the `.blend`, look through **LoadingCamera**, and scrub the timeline.
The GPU viewport uses that camera (or Blender freecam if you leave camera view).
Sidebar **Halo 3 → GPU Viewport** toggles the shader path vs the EEVEE preview.

**Render Animation / F12** uses the **Halo 3 Loading** engine (same GLSL as the viewport).
Enable **Edit → Preferences → Save & Load → Auto Run Python Scripts**, or the
engine is missing and Blender falls back to EEVEE. Use **Standard** view
transform, not Filmic/AgX.

Reload the GPU script after pulling changes:

```bash
blender export/halo3_loading_screen.blend --python tools/halo3_loading_gpu.py
```

## Usage
Feel free to use this project for whatever you want. Credit me if you feel like it, idc. 

Have fun
