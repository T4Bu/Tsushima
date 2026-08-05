# Crimson Wind Basin

Crimson Wind Basin is a real-time, walkable 250 Ã— 250 metre biome inspired by
the cinematic landscape language of *Ghost of Tsushima*. It is an original
place rather than a recreation of a shipped location: a bamboo ridge opens into
a crimson spider-lily floodplain, an amber reed basin, a shallow reflective
stream, and a wind-shaped sanctuary tree.

The scene uses a hybrid asset approach. Terrain form, habitat masks, vegetation,
bamboo, flowers, landmarks, water motion, wind, particles, sky, fog, and ambient
audio are generated or assembled procedurally at runtime. A compact set of
locally licensed Megascans surface maps adds PBR detail to the forest floor,
trail, and wet stream banks. Two MIT-licensed EZ-Tree models and related sprites
supply the nearby and distant broadleaf silhouettes; deterministic placement,
instancing, wind deformation, tinting, and contact shadows remain runtime code.
If those tree files fail to load, the procedural woodland remains as an offline
fallback.

## Run locally

The project requires Node.js and npm. On Windows PowerShell:

```powershell
npm.cmd install
npm.cmd run dev
```

Open the URL printed by Vite, normally <http://127.0.0.1:5173>, then choose
**Enter the basin**. Click the rendered scene again whenever you need to
reacquire mouse look.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` or arrow keys | Walk |
| Mouse | Look while the pointer is captured |
| `Shift` | Sprint |
| `P` | Toggle photo mode and the HUD |
| `R` | Return to the bamboo entry |
| `1` | Entry viewpoint |
| `2` | Basin reveal viewpoint |
| `3` | Sanctuary tree viewpoint |
| `4` | River viewpoint |
| `5` | Meadow viewpoint |
| `Esc` | Release the pointer |

The player is grounded against the same deterministic analytic height function
used to build the terrain, path, stream bed, vegetation, bridge, and landmarks.

## Build, preview, and capture

```powershell
npm.cmd run build
npm.cmd run preview
```

The production bundle is written to `dist/`. To render the regression views:

```powershell
npm.cmd run capture
```

The capture script starts a local Vite server on port 4173 when needed, renders
five deterministic 1600 Ã— 900 views at simulation time `18.5`, and writes
`entry.png`, `reveal.png`, `meadow.png`, `river.png`, `tree.png`, plus browser
errors and scene statistics in `captures/manifest.json`.

You can open a deterministic view directly while the dev server is running:

```text
http://127.0.0.1:5173/?shot=reveal&time=18.5&quality=high
```

`shot` accepts `entry`, `reveal`, `meadow`, `river`, or `tree`. `quality`
accepts `high`, `medium`, or `low`; `time` freezes the simulation at the given
number of seconds.

## Rendering approach

- GPU-instanced grass, reeds, crimson flowers, bamboo, tree parts, and distant
  tree sprites
- Habitat-masked floor strata with patch-aligned curved sedges, a short matted
  basin underlayer, fern colonies, low leaf litter, and deliberate path-edge recovery
- One deterministic world-space gust field shared by vegetation, tree shaders,
  banners, particles, and water
- Large analytic habitat masks that create deliberate red, gold, and green
  color masses instead of uniform procedural scatter
- A 250 m heightfield with a walkable winding path and shallow meandering stream
- Compact albedo, OpenGL normal, and packed ORM maps for forest, path, and wet
  bank surfaces; the source-resolution scans are not shipped
- Dark teal/copper water with animated geometry, view-angle reflections, and a
  narrow broken track of sunset glints
- Procedural torii, lanterns, bridge, rocks, exposed roots, and hero-tree
  structure combined with licensed broadleaf foliage and woodland assets
- Low sunset key, cool shadow fill, layered silhouettes, exponential amber fog,
  bloom, vignette, film grain, ACES filmic tone mapping, and capped pixel ratio
- Filtered-noise wind ambience generated after the first user interaction

Art-direction decisions are recorded in [direction.md](./direction.md). Asset
origins and redistribution cautions are summarized in
[ASSET_PROVENANCE.md](./ASSET_PROVENANCE.md).
