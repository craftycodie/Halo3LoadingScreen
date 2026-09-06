![hero image](./hero.png)

### [View Loading Screen](https://craftycodie.github.io/Halo3LoadingScreen/)


# Halo 3 - Loading Screen 

This is a WebGPU recreation of the loading screen for Halo 3 on the Xbox 360 created with a focus on parity with the original game.

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

## Usage
Feel free to use this project for whatever you want. Credit me if you feel like it, idc. 

Have fun

## Credits

- Bungie for creating the original loading screen.
- Xephorium - I stole the HD logo from [your remaster](https://github.com/Xephorium/Halo3LoadingScreen), SOZ!
