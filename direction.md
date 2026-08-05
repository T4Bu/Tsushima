# Crimson Wind Basin â€” direction

This is a single 250 Ã— 250 metre sunset basin built around the broad cinematic
language of the supplied *Ghost of Tsushima* references. It is an original
environment, not a reconstruction of a game location or an extraction of game
assets.

## The walk

The player begins inside a cool, elevated bamboo grove. A narrow track and
weathered torii compress the view before the land opens into a broad crimson
flower basin. The path bends through amber grass, crosses a shallow reflective
stream, then arrives at an ancient wind-shaped tree and three battle-worn
banners. The tree is the permanent navigation anchor; a return trail through
the outer woodland completes the implied loop.

## Visual rules

- Compose in large color masses: black-green bamboo, crimson flowers, tawny
  grass, dark wet banks, cool clear water, and a gold sky.
- Keep terrain form quiet enough for vegetation and silhouette to carry the
  composition. Scanned PBR detail should reward walking without turning the
  ground into the subject.
- Use a low sunset behind the landmarks, cool teal fill in shadows, layered
  amber fog, long shadows, restrained bloom, and a filmic shoulder.
- Wind is systemic. Grass, flowers, bamboo leaves, licensed tree foliage,
  banners, water, and loose petals respond to the same world-space gust field.
- Dense habitat patches matter more than species count. Avoid evenly scattered
  procedural confetti.
- Woodland floors use three readable strata: low litter and loose grass,
  mostly upright sedges with a restrained swept subset, and sparse fern
  colonies. Local headings vary around a patchwise resting flow so the floor
  feels wind-shaped without collapsing into repeated parallel arcs.
- Beneath the crimson flowers, a short loose underlayer closes broad soil gaps
  without competing with the flower heads, path silhouettes, river margin, or
  hero-tree clearing.
- Preserve walkability: the dirt route, bridge, stream shallows, torii, and tree
  clearing all share the analytic terrain height used by the player controller.
- Use natural assets as texture and silhouette amplifiers, not as layout. Their
  placement, scale, tint, wind, culling, and fallback behavior belong to the
  deterministic biome system.

## Palette

| Role | Color |
| --- | --- |
| Sun core | `#FFD17A` |
| Horizon haze | `#E98042` |
| Crimson flowers | `#D32225` / `#85151D` |
| Tawny grass | `#B88443` / `#E0B86A` |
| Bamboo shadow | `#0B1B1D` / `#163B34` |
| Bark and stone | `#4B3D31` |
| Stream body / sunset glint | `#315A56` / `#FF9B55` |

## Hybrid material language

The basin silhouette, heights, path, river course, habitat masks, vegetation,
landmarks, and animation are procedural. Three browser-sized Megascans material
families provide the close surface read: forest debris across the basin,
trampled mud along the route, and darker wet soil feathered beneath and beside
the stream. Their normal and ORM maps are kept channel-safe and deliberately
small; broad vertex tint and a dry-ground roughness floor prevent obvious scan
tiling or glossy terrain.

The forest-floor silhouette is geometric rather than painted into the terrain:
opaque tapered strips form upright and gently swept sedges, low solid meshes
supply leaf litter, and one original alpha-cutout fern supplies complex
secondary leaflets. Broad deterministic flow fields bias each patch while
local heading variation and the shared gust field keep the floor irregular.

Two textured broadleaf variants provide the natural woodland and the foliage
mass around the hero tree. The runtime flattens and instances their parts,
applies deterministic placement exclusions around paths and water, patches the
materials for gust deformation and warm edge scatter, and retains procedural
trees as the load-failure fallback. Related sprites extend the same silhouettes
into the fog without spending nearby-tree geometry at the horizon.

## Performance shape

Dense grass, reeds, flowers, bamboo, tree parts, contact shadows, and distant
sprites are GPU-instanced and grouped by material. Small foliage does not cast
individual shadows; trunks, hero forms, shrine structures, and selected rocks
do. Distant density is carried by sprites, terrain color, and fog. Quality tiers
reduce population counts and cap pixel ratio while preserving the route,
landmarks, and deterministic camera compositions.

The five fixed views (`entry`, `reveal`, `meadow`, `river`, and `tree`) are part
of the visual contract. At a fixed simulation time they should remain stable
enough to compare lighting, density, shader compilation, and asset-loading
regressions between revisions.
