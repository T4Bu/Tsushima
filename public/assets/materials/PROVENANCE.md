# Terrain material provenance

These nine WebP textures are browser-sized derivatives of the user's locally
licensed Fab/Marketplace Megascans library. They are not original project art.

| Output prefix | Local source set | Original size | Source maps |
| --- | --- | ---: | --- |
| `forest_*` | `C:\source\game\game\assets\licensed\megascans\forest_hardscape\terrain\ForestGround` | 4096 x 4096 | `albedo.png`, `normal_gl.png`, `orm.png` |
| `path_*` | `C:\source\game\game\assets\licensed\megascans\forest_hardscape\terrain\TrampledMud` | 4096 x 4096 | `albedo.png`, `normal_gl.png`, `orm.png` |
| `bank_*` | `C:\source\game\game\assets\licensed\megascans\forest_hardscape\terrain\WetSoil` | 8192 x 8192 | `albedo.png`, `normal_gl.png`, `orm.png` |

Conversion was performed locally with FFmpeg 8.1 and Lanczos downsampling.
Albedo maps are 1024 x 1024 lossy WebP at quality 78. OpenGL normal and packed
ORM maps are 512 x 512 lossless WebP so their vector/data channels are not
chroma-subsampled. The complete output payload is about 2.8 MiB. In the
runtime, ORM red supplies ambient occlusion and ORM green supplies roughness.

The source library manifest is:

`C:\source\game\game\assets\licensed\megascans\forest_hardscape\local-asset-manifest.json`

That manifest describes the content as local Fab/Marketplace material supplied
by the user and explicitly does not restate or alter its source license. No
standalone LICENSE or NOTICE was present beside the source maps. Keep these
derivatives in local/private builds unless the applicable Fab license has been
checked for the intended form of deployment; in particular, serving raw texture
files is different from distributing only a rendered image or video.