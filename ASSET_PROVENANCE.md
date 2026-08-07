# Asset provenance

Crimson Wind Basin is a hybrid procedural scene. Most geometry, placement,
motion, lighting, atmosphere, audio, and post-processing are authored in this
repository. The runtime also uses the compact external assets listed below.

## EZ-Tree broadleaf assets

Runtime files:

- `public/assets/trees/tree_0.glb`
- `public/assets/trees/tree_2.glb`
- `public/assets/trees/tree-sprite-0.png`
- `public/assets/trees/tree-sprite-2.png`

The repository identifies these EZ-Tree assets with the bundled
[MIT License](./public/assets/trees/LICENSE-EZ-TREE.txt), copyright 2024 Daniel
Greenheck. Keep that copyright and permission notice with copies or substantial
portions of the assets. The GLBs supply instanced nearby trees and the PNGs
supply distant silhouettes; runtime placement and wind deformation are project
code.

## Megascans terrain material derivatives

Runtime files are the nine WebP maps under `public/assets/materials/` with the
prefixes `forest_`, `path_`, and `bank_`. They are compact derivatives of the
user's locally licensed Fab/Marketplace Megascans library, specifically the
`ForestGround`, `TrampledMud`, and `WetSoil` sets. Exact local source paths,
source resolutions, conversion settings, and channel use are recorded in the
[material provenance note](./public/assets/materials/PROVENANCE.md).

The local source manifest does not itself grant or restate a license, and no
standalone source LICENSE or NOTICE was found beside those maps. Confirm the
applicable Fab license before public deployment or redistribution. A web build
serves the texture files to clients, so publishing this project is materially
different from sharing only rendered screenshots or video. This note records
provenance; it is not a substitute for the governing license.

## Original generated foliage textures

`public/assets/vegetation/bamboo-frond.png` was generated specifically for this
project from an original text prompt with OpenAI image generation, then locally
chroma-keyed to a transparent alpha cutout. It is instanced on crossed crown
cards; all culm geometry, crown layout, placement, shading, and wind deformation
remain project code. It was not copied from *Ghost of Tsushima* or another game.

`public/assets/vegetation/forest-fern.png` was produced through the same original
prompt-and-chroma-key workflow for the woodland groundcover pass. The runtime
places it on individually rotated fern-frond cards inside deterministic colonies;
the habitat masks, clump geometry, tinting, distance treatment, and wind response
are project code.

## Original generated architectural textures

The five 1024 x 1024 WebP files under `public/assets/architecture/` were generated
specifically for this project with OpenAI image generation from original prompts:
mineral stucco, pale limestone, vein-cut limestone, oiled cedar, and permeable
aggregate. The generated PNG outputs were resized with Lanczos filtering and
encoded to WebP at quality 88 for runtime use; those source PNGs are retained in
`docs/assets/architecture-sources/` and are not included in the production build.
Runtime shader code projects the WebPs in compound-local metres, derives
restrained micro-relief and roughness variation, and mirrors the repeats to keep
differently scaled instanced walls, slabs, cladding, woodwork, and paving visually
continuous. They were not copied from *Ghost of Tsushima* or another game.

## Originality boundary

The project uses *Ghost of Tsushima* as a high-level visual reference only. No
game models, textures, maps, audio, or extracted data are included. The basin
layout, analytic terrain, vegetation systems, landmarks, shaders, animation,
ambient audio synthesis, camera presets, and presentation are original project
work except for the external assets identified above.
