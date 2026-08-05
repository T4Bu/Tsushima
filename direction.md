# Crimson Wind Basin

This scene is a single 250 × 250 metre sunset basin built around the visual language of the supplied Ghost of Tsushima references. It is an original environment rather than a recreation of a shipped location.

## The walk

The player begins inside a cool, elevated bamboo grove. A narrow track and weathered torii compress the view before the land opens into a broad crimson flower basin. The path bends through shoulder-high amber grass, crosses a shallow reflective stream, then arrives at an ancient wind-shaped tree and three battle-worn banners. The tree is the permanent navigation anchor; a return trail through the outer woodland completes the implied loop.

## Visual rules

- Compose in large color masses: black-green bamboo, crimson flowers, amber grass, copper water, gold sky.
- Keep the terrain quiet so vegetation and silhouette carry the image.
- Use a low sunset behind the landmark, cool teal fill in shadows, layered amber fog, long shadows, restrained bloom, and a filmic shoulder.
- Wind is systemic. Grass, flowers, bamboo leaves, banners, water, and loose petals share the same world-space gust direction.
- Dense patches matter more than species count. Avoid evenly scattered procedural confetti.
- Preserve walkability: the dirt route, bridge, river shallows, torii, and tree clearing all use the same analytic terrain height as the player controller.

## Palette

| Role | Color |
|---|---|
| Sun core | `#FFD17A` |
| Horizon haze | `#E98042` |
| Crimson flowers | `#D32225` / `#85151D` |
| Tawny grass | `#B88443` / `#E0B86A` |
| Bamboo shadow | `#0B1B1D` / `#163B34` |
| Bark and stone | `#4B3D31` |
| Copper water | `#593628` |

## Performance shape

Vegetation is GPU-instanced and grouped by species. Foliage does not cast individual shadows; trunks, the hero tree, shrine structures, and rocks do. Distant density is carried by terrain color and silhouettes through fog. This keeps the scene fluid while preserving the high-density field read.
