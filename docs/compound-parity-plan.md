# Compound visual-parity plan

> **Status (2026-08-06):** implemented through Phase 5, except the offline
> normal/ORM texture bake (Phase 2 item 3), which remains open — the projected
> surfaces currently compensate with stronger luminance bump, macro tint, and
> wear fields. A full-perimeter boundary fence (terrain-stepped panels in the
> street-threshold language) was added on top of the plan. Shared systems live
> in `src/world/biome-shared.js`.

Goal: make the courtyard compound read with the same density, atmosphere, and
painterly surface quality as the basin environment in the fixed capture views
(`compound`, `courtyard`, `pooldetail`, `arrival`, `gate`, `fabyard`, `lanai`,
`lanaithreshold`).

## Diagnosis — why the compound reads flat

The environment's richness comes from a small set of unifying systems
(shared wind field, per-instance tint, warm rim/backscatter, in-shader warm
height fog, real Megascans normal/ORM maps, macro mottling). The compound
re-implements its own material pipeline but participates in **none** of them:

1. **Albedo-only textures at low mix strength.** The five architecture maps
   load correctly (`compound-architecture.js:202-227`) but there are no
   normal/roughness/AO companions; "bump" is derived from albedo luminance
   (`:844-847`), which is nearly invisible on broad walls. Stucco mixes the map
   at 72% (`colorStrength 0.72`), the roof at only 42% (`:1611-1621`) — the
   parapet and big elevations resolve to near-pure flat white.
2. **Monotone hardscape.** Every paved surface (pool deck, paths, coping)
   shares one `stone` material (`:1622-1632`) with **no** wear/mottle — the
   mottling/drainage/wheel-track shader exists but is applied only to the
   motor-court `drive` material (`:1681-1702`).
3. **No ambient occlusion anywhere.** No aoMap, no vertex AO, no junction
   darkening. Soft contact blobs exist but only under furniture/plants
   (`:1963-1968` explicitly skips building volumes); the sunk foundation
   plinth meets terrain as a hard box edge — the source of the harsh
   pad-to-meadow lines in `gate`/`fabyard`.
4. **No per-instance variation.** Wall/paving `InstancedMesh` batches use a
   single uniform color, no `instanceColor` jitter (the environment hashes a
   tint per instance everywhere).
5. **Disconnected from the biome systems.** `createCompoundPlan` is called
   without `windUniforms` or `quality` (`main.js:98-101`). Grep confirms zero
   references to `sampleBiomeWind`, `uWind*`, `hash2`, `valueNoise` in any
   `compound*.js`. Compound greenery is fully static beside a meadow that
   visibly moves, gets no warm height-fog term, no warm-edge scatter, no
   shared noise.
6. **Spiky opaque planter plants.** `addPlant` fans 13 opaque hand-built
   6-triangle lance leaves (`:1247-1265`, `:3121-3145`) — the hard agave
   spikes in the courtyard shots — while the environment uses alpha-cutout
   fronds/ferns with transmission and rim light.
7. **Flat glass.** `applyGlassResponse` is an analytic tint/fresnel only
   (`:1081-1185`) with no reflection content — panes read as dark sheets.
8. **Calm-but-flat pool.** `makePoolWater` (`:1331-1462`) is a decent analytic
   shader, but a 1×1-segment plane with a soft glint; the stream's read comes
   from a *broken* gold glint track + strong fresnel + dark teal body
   (`terrain.js:1123-1132`), which the pool lacks at wide framing.
9. Misc: no texture load-failure fallback (blank map pulls toward flat/black),
   dead second `makePoolWater` in `compound.js:792-920`, no quality-tier
   scaling in the compound.

## Plan

### Phase 1 — join the biome's unifying systems (highest leverage)

1. **Extract shared infrastructure.** New `src/world/biome-shared.js` exporting
   `WIND_FIELD_GLSL` / `sampleBiomeWind`, the deterministic noise helpers
   (`hash2`, `valueNoise`, `fbm`, `mulberry32`), and the warm height-fog GLSL
   term (currently copy-pasted across terrain/vegetation/natural-assets).
   Refactor those three modules to import it (behavior-neutral).
2. **Wire the compound in.** Pass `windUniforms` and `quality` into
   `createCompoundPlan`. Add the gust vertex bend to the compound frond cards,
   planter leaves, garden beds, and banner-like soft elements; add the
   `worldY` warm-fog multiplier and warm edge/rim response into the compound's
   existing `onBeforeCompile` hooks (`applyProjectedSurface`,
   `applyPlanZoneResponse`) so architecture fogs and rims on the same curve as
   the landscape.

### Phase 2 — surface breakup on architecture

3. **Real normal + ORM companions** for mineral-stucco, pale-limestone,
   vein-cut-limestone, oiled-cedar, permeable-aggregate (small webp, same
   channel-safe discipline as the terrain scans). Bind orm→aoMap/roughnessMap
   like `terrain.js:511-513`. Raise roof `colorStrength` 0.42 → ~0.75.
4. **Extend wear/mottle to all hardscape.** Apply the drive mottling recipe
   (aggregate variation + drainage darkening) to the `stone` paving material,
   plus subtle edge-darkening where paving meets beds/pool coping.
5. **Per-instance tint jitter.** Give wall/paving/cedar batches ±2–3% value
   and slight warm/cool hue variation via `instanceColor`, seeded from shared
   noise; orientation-aware (sunset-facing slightly warmer).
6. **Cheap AO.** (a) world-Y "ground contact" darkening term in the
   architecture shader for the bottom ~0.5 m of walls and plinths; (b) soft
   multiply contact strips along building perimeters (reuse
   `makeSoftContactTexture`); (c) corner/inside-edge AO term in the triplanar
   weathering shader.

### Phase 3 — landscape integration at the boundary

7. **Feather the pad edge.** Replace hard pad-to-meadow lines with native
   grass/sedge encroachment instanced from the vegetation archetypes, driven
   by an exclusion mask (walks, bays, doors, aprons stay clear), densest along
   the `gate`/`fabyard` frontages.
8. **Rebuild courtyard planting.** Swap the 13-leaf opaque lance plants for
   alpha-cutout foliage using the existing frond/fern textures with the
   vegetation material recipe (per-instance tint, transmission, rim, wind).
   Keep silhouettes tighter/curated than wild planting — it should read
   designed, just not dead.

### Phase 4 — glass, water, light polish

9. **Glass with content.** Reuse the sky-dome gradient function as an analytic
   reflection source modulated by fresnel so panes carry the sunset gradient;
   keep interiors visible through the warm-side falloff.
10. **Pool glint parity.** Port the stream's broken sun-glint track and
    stronger low-sun fresnel into `makePoolWater`, tuned calmer; keep the
    existing depth absorption/caustics.
11. **Wall sunset response.** Slightly lower the stucco roughness floor on
    lit faces and let the new rim term carry a warm gradient so white volumes
    take the palette instead of staying neutral.

### Phase 5 — hygiene

12. Delete the dead `makePoolWater` in `compound.js:792-920`.
13. Add texture `onError`/pending fallbacks so failed loads keep authored base
    colors instead of pulling flat/black.
14. Scale compound detail (contact cards, planting counts, frond cards) by the
    quality tier now passed in.

## Verification

After each phase run `scripts/capture.mjs` and diff the fixed views —
especially `compound`, `courtyard`, `gate`, `fabyard`, `pooldetail`,
`arrival` — against the current `captures/` set. Parity bar: the compound
shots should show (a) visible surface grain on walls/paving at hero distance,
(b) moving foliage, (c) no hard ground junction lines, (d) a pool glint that
rhymes with the stream, while the environment views stay pixel-stable.
