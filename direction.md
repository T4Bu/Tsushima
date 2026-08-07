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

## Courtyard compound

The entire 150 x 130 ft (0.45-acre) site is realized at 1:1 scale on the flat
eastern meadow edge. The 2,080 SF main house, fab lab, garage, and guest house
frame a pool court, with one 62 x 12 ft lanai opening the main living spaces to
the water. Covered links, the motor court, kitchen garden, and designed
landscaping make the compound read as a complete place rather than a plan-stage
mockup.

The south edge is now a built threshold rather than an implied property line:
stone piers, parked cedar sliding leaves, screened privacy wings, and a separate
service opening preserve the full 38 ft motor-court throat. The same fence
language now continues around the west, north, and east boundaries — terrain-
stepped stucco plinths, stone caps, charcoal posts, and horizontal cedar rails
between corner piers — so the whole lot reads as one enclosed compound whose
only openings are the two street gates. Garage storage and
door hardware, fab-lab workstations, and composed living-room details keep the
same standard of occupation in close views.

A 60.7 m terrain-following aggregate-and-dirt spur now branches from the basin
trail and reaches that threshold. It keeps a 3.2-3.8 m travelling width, flares
across the final 11 m, clears tall vegetation while retaining low native
shoulders, and aligns its terminal edge to the open gate. Continuous aggregate
mottling, wheel compaction, drainage variation, texture-authored courtyard
fronds, sparse leaf litter, and damp coping patches carry landscape-scale
surface breakup into the managed court.

The architectural language is restrained and warm: white stucco volumes,
black-framed glazing, cedar accents, low flat roofs, and illuminated interiors
sit against the basin's sunset palette. Walls and the pool have player
collision, while `B` toggles the full-scale blueprint overlay for comparing the
finished architecture with its source layout. Key `6` returns to the compound
hero view.

Architectural texture stays material-specific and quiet: fine troweled mineral
stucco, pale honed limestone paving, warmer vein-cut feature piers, linear cedar
grain, and compact permeable aggregate. These textures are projected in compound-
local metres so a long wall and a narrow slat retain the same physical texel
scale despite sharing instanced unit geometry. Glass, black metal, pool water,
lighting, and foliage remain visually clean counterpoints.

The compound is coupled to the biome's unifying systems rather than rendered
beside them. Courtyard planting — planter blades, bed layers, herb clumps, and
the texture-authored fronds — bends with the same world-space gust field as the
meadow; exterior shells share the warm height-graded fog and a restrained
sun-facing rim with the natural silhouettes; a continuous macro tint field,
hardscape mottling on every paved surface, and ground-contact darkening at wall
bases break the flat instanced colour the way terrain vertex tint breaks the
ground. Glazing carries an analytic sunset-sky reflection and the pool shares
the river's low sun and broken gold glint track, so both waters and both
"renderers" read as one world. Inside, warm honed
floors, projected wood grain, fine woven upholstery, rounded furniture edges,
garage mechanisms, and fabrication-machine hardware keep the inhabited spaces
credible when the camera moves from the courtyard into arm's-length views.

The private rooms now carry that fidelity through the main bedroom wing and
guest house. Layered beds and neutral woven textiles sit on white-oak floors;
true-depth wardrobes and linen storage break around authored door swings; and
the baths include vanities, mirrors, tubs or showers, toilets, towels, plumbing,
and limestone wet-zone floors. A warmer plaster response is limited to interior
wall faces, while restrained private ambient and emissive cues preserve the
public-room lighting hierarchy without contaminating the exterior shell.

Exterior construction is equally explicit: folded zinc parapet coping, drip
hems, scuppers and downspouts, drain-aligned mineral runoff, head/sill flashing,
flush slider tracks, slotted threshold drains, heavier lanai posts, shoes, beam,
and gutter give the low volumes a believable assembly hierarchy. The pool adds
depth absorption, analytic sky/façade reflection, restrained caustics, ladder
hardware, damp coping, and an occupied west deck with fitted outdoor kitchen
and refined loungers. A low native bioswale resolves the arrival-to-court grade
change while leaving the stepping-stone axis and guest walk open.

The guest house, fabrication wing, and garage now carry their own secondary
construction language instead of relying on the primary house at a distance:
deep opening returns, slim corner closures, raised-volume roof edges, recessed
service lights, louvers, meters, conduit, mechanical equipment, a guest entry
bench, and braced fab canopies establish believable scale and use. Exterior-only
stucco masks add slightly different aggregate, runoff, corner, and tint response
to each volume without dirtying interior partitions. Irregular low planting,
aggregate flecks, and broken seam patches soften their ground junctions while
explicit access exclusions preserve every walk, bay, door, and service apron.

## Performance shape

Dense grass, reeds, flowers, bamboo, tree parts, contact shadows, and distant
sprites are GPU-instanced and grouped by material. Small foliage does not cast
individual shadows; trunks, hero forms, shrine structures, and selected rocks
do. Distant density is carried by sprites, terrain color, and fog. Quality tiers
reduce population counts and cap pixel ratio while preserving the route,
landmarks, and deterministic camera compositions.

The twenty-five fixed views (`entry`, `reveal`, `transition`, `meadow`, `river`, `tree`,
`compound`, `courtyard`, `pooldetail`, `outdoorkitchen`, `arrival`, `guesthouse`,
`guestbed`, `greatroom`, `primarysuite`, `primarybath`, `bedroom`, `garage`,
`garagebay`, `fab`, `fabmachine`, `fabyard`, `lanai`, `lanaithreshold`, and `gate`)
are part of the visual contract. At a fixed simulation time they should
remain stable enough to compare lighting, density, shader compilation,
asset-loading, and close-detail regressions between revisions.
