# Crimson Wind Basin

A real-time, walkable 250 × 250 metre biome inspired by the cinematic landscape language of *Ghost of Tsushima*. It is an original place: a bamboo ridge opens into a crimson spider-lily floodplain, an amber reed basin, a shallow copper stream, and a wind-shaped sanctuary tree.

The scene is entirely procedural. There are no downloaded models or texture packs: terrain, flowers, grass, bamboo, trees, landmarks, water, particles, fog, sky, and ambient wind audio are generated at runtime.

## Run it

```powershell
npm.cmd install
npm.cmd run dev
```

Open the local URL printed by Vite (normally `http://127.0.0.1:5173`) and choose **Enter the basin**.

## Controls

| Input | Action |
|---|---|
| `W A S D` | Walk |
| Mouse | Look |
| `Shift` | Sprint |
| `P` | Toggle photo mode |
| `R` | Return to the bamboo entry |
| `1`–`5` | Jump to curated viewpoints |
| `Esc` | Release the pointer |

The player is grounded against the same analytic height function used to build the terrain, path, riverbanks, vegetation, bridge, and landmarks.

## Build and visual capture

```powershell
npm.cmd run build
npm.cmd run capture
```

`npm.cmd run capture` renders five deterministic 1600 × 900 views into `captures/` and records browser errors and scene statistics in `captures/manifest.json`.

For a direct deterministic viewpoint, use query parameters:

```text
http://127.0.0.1:5173/?shot=reveal&time=18.5&quality=high
```

`shot` accepts `entry`, `reveal`, `meadow`, `river`, or `tree`. `quality` accepts `high`, `medium`, or `low`.

## Rendering approach

- GPU-instanced tawny grass, reeds, crimson flowers, bamboo, and tree foliage
- One shared world-space gust field across vegetation, banners, particles, and water
- Large analytic habitat masks that create deliberate red/gold/green color masses
- Deterministic 250 m heightfield with a walkable S-path and shallow S-stream
- Procedural hero tree, torii, lanterns, bridge, rocks, and exposed roots
- Low sunset key, cool shadow fill, layered silhouettes, exponential amber fog, bloom, vignette, and film grain
- ACES filmic tone mapping and a capped device-pixel ratio for stable performance
- Generated filtered-noise wind ambience after the first user interaction

The design and palette decisions are recorded in [direction.md](./direction.md).
