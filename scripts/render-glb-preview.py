"""Render a deterministic Blender preview for a glTF/GLB asset.

Usage:
  blender --background --factory-startup --python scripts/render-glb-preview.py -- input.glb output.png
"""

import math
import sys

import bpy
from mathutils import Vector


def asset_bounds(objects):
    points = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    minimum = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    maximum = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return minimum, maximum


def look_at(obj, target):
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


args = sys.argv[sys.argv.index("--") + 1 :]
source_path, output_path = args[:2]
transparent = len(args) > 2 and args[2].lower() == "transparent"

bpy.ops.import_scene.gltf(filepath=source_path)
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
minimum, maximum = asset_bounds(meshes)
center = (minimum + maximum) * 0.5
size = maximum - minimum
radius = max(size.x, size.y, size.z)

if not transparent:
    bpy.ops.mesh.primitive_plane_add(size=max(radius * 3.2, 8), location=(center.x, center.y, minimum.z - 0.02))
    ground = bpy.context.object
    ground.data.materials.append(bpy.data.materials.new("Preview ground"))
    ground.data.materials[0].diffuse_color = (0.055, 0.07, 0.065, 1)

bpy.ops.object.light_add(type="AREA", location=(center.x - radius * 0.9, center.y - radius * 0.8, center.z + radius * 1.1))
bpy.context.object.data.energy = 1200
bpy.context.object.data.shape = "DISK"
bpy.context.object.data.size = radius
look_at(bpy.context.object, center)

bpy.ops.object.light_add(type="SUN", location=(center.x + radius, center.y - radius, center.z + radius))
bpy.context.object.data.energy = 3.2
bpy.context.object.rotation_euler = (math.radians(35), math.radians(-20), math.radians(-35))

bpy.ops.object.camera_add(location=(
    center.x if transparent else center.x + radius * 1.35,
    center.y - radius * (2.55 if transparent else 1.7),
    center.z + (size.z * 0.02 if transparent else radius * 0.48),
))
camera = bpy.context.object
camera.data.lens = 58
look_at(camera, center + Vector((0, 0, size.z * (0.02 if transparent else 0.08))))
bpy.context.scene.camera = camera

world = bpy.context.scene.world
world.color = (0.025, 0.035, 0.04)
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = output_path
scene.render.film_transparent = transparent
scene.view_settings.look = "AgX - Medium High Contrast"
bpy.ops.render.render(write_still=True)