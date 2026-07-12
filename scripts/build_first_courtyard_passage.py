"""Build a continuous first-courtyard/first-passage study model in Blender.

Run with:
  blender --background --python scripts/build_first_courtyard_passage.py
"""

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "geometry-export.json"
OUT_DIR = ROOT / "public" / "models"
RENDER_DIR = ROOT / "tmp" / "blender"


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def source_bounds(name):
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    item = next(geometry for geometry in data["geometries"] if geometry["name"] == name)
    points = [vertex["xyz_m"] for vertex in item["vertices"]]
    return {
        "x": (min(p[0] for p in points), max(p[0] for p in points)),
        "y": (min(p[1] for p in points), max(p[1] for p in points)),
        "z": (min(p[2] for p in points), max(p[2] for p in points)),
    }


def add_quad(vertices, faces, a, b, c, d):
    start = len(vertices)
    vertices.extend((a, b, c, d))
    faces.append((start, start + 1, start + 2, start + 3))


def create_interior():
    courtyard = source_bounds("第一天井")
    passage = source_bounds("第一过洞")

    # Manual archaeological adjustment: align both structures to one shared portal
    # and regularize the small survey skew without erasing the longitudinal slope.
    portal_x = sum((courtyard["x"][0], passage["x"][1])) / 2
    south_x = passage["x"][0]
    north_x = courtyard["x"][1]
    half_width = 0.59
    floor_south = 0.88
    floor_portal = 0.20
    floor_north = -0.706
    spring_south = 1.86
    spring_portal = 1.62
    crown_south = passage["z"][1]
    crown_portal = 2.10
    courtyard_top = courtyard["z"][1]

    vertices = []
    faces = []

    # Shared sloping floor: four longitudinal stations soften the survey kink.
    stations = (
        (south_x, floor_south),
        (south_x * 0.35 + portal_x * 0.65, floor_south * 0.35 + floor_portal * 0.65),
        (portal_x, floor_portal),
        (portal_x * 0.55 + north_x * 0.45, floor_portal * 0.55 + floor_north * 0.45),
        (north_x, floor_north),
    )
    for (x0, z0), (x1, z1) in zip(stations, stations[1:]):
        add_quad(vertices, faces, (x0, -half_width, z0), (x1, -half_width, z1),
                 (x1, half_width, z1), (x0, half_width, z0))

    # Passage walls and a rounded, seven-strip barrel vault.
    arch_segments = 10
    rings = []
    for x, floor_z, spring_z, crown_z in (
        (south_x, floor_south, spring_south, crown_south),
        (portal_x, floor_portal, spring_portal, crown_portal),
    ):
        ring = [(x, -half_width, floor_z), (x, -half_width, spring_z)]
        for index in range(1, arch_segments):
            theta = math.pi - math.pi * index / arch_segments
            y = half_width * math.cos(theta)
            z = spring_z + (crown_z - spring_z) * math.sin(theta)
            ring.append((x, y, z))
        ring.extend(((x, half_width, spring_z), (x, half_width, floor_z)))
        rings.append(ring)
    # Archaeological cutaway: omit the near wall and near half of the vault so the
    # serial relationship remains legible from an exterior overview camera.
    crown_index = 1 + arch_segments // 2
    for index in range(crown_index, len(rings[0]) - 1):
        add_quad(vertices, faces, rings[0][index], rings[1][index],
                 rings[1][index + 1], rings[0][index + 1])

    # Courtyard side walls continue from the portal to the open top.
    for side in (1,):
        y = side * half_width
        add_quad(vertices, faces, (portal_x, y, floor_portal), (north_x, y, floor_north),
                 (north_x, y, courtyard_top), (portal_x, y, courtyard_top))
    add_quad(vertices, faces, (north_x, -half_width, floor_north),
             (portal_x, -half_width, floor_portal), (portal_x, -half_width, courtyard_top),
             (north_x, -half_width, courtyard_top))
    # Replace preceding accidental overlap with the actual north wall below.
    faces.pop()
    del vertices[-4:]
    add_quad(vertices, faces, (north_x, half_width, floor_north),
             (north_x, -half_width, floor_north), (north_x, -half_width, courtyard_top),
             (north_x, half_width, courtyard_top))

    # South wall of the open shaft wraps the tunnel portal, leaving the arch open.
    portal_ring = rings[1]
    for index in range(crown_index, len(portal_ring) - 2):
        left = portal_ring[index]
        right = portal_ring[index + 1]
        add_quad(vertices, faces, left, (portal_x, left[1], courtyard_top),
                 (portal_x, right[1], courtyard_top), right)
    # The spandrel follows the curved opening instead of closing the shared boundary.
    # Backface culling is disabled so the model reads correctly from inside and above.

    mesh = bpy.data.meshes.new("FirstCourtyardPassageContinuousMesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("第一天井_第一过洞_连续内表面", mesh)
    bpy.context.collection.objects.link(obj)

    material = bpy.data.materials.new("夯土内壁")
    material.diffuse_color = (0.34, 0.235, 0.14, 1.0)
    material.use_backface_culling = True
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.31, 0.205, 0.115, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.92
    obj.data.materials.append(material)

    solidify = obj.modifiers.new("Cutaway soil thickness", "SOLIDIFY")
    solidify.thickness = 0.10
    solidify.offset = 1.0
    bevel = obj.modifiers.new("Soft earthen edges", "BEVEL")
    bevel.width = 0.025
    bevel.segments = 2
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth_by_angle()
    return obj


def setup_preview(target):
    world = bpy.context.scene.world
    world.color = (0.025, 0.025, 0.025)
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.035, 0.045, 0.055, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.32

    for location, energy, size in (((-2.1, -3.7, 5.8), 1000, 4.0), ((-4.8, 2.4, 3.1), 650, 2.5)):
        light_data = bpy.data.lights.new("Area", "AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new("Area", light_data)
        light.location = location
        bpy.context.collection.objects.link(light)

    camera_data = bpy.data.cameras.new("PreviewCamera")
    camera = bpy.data.objects.new("PreviewCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (-7.2, -8.6, 7.2)
    direction = Vector((-3.0, 0.0, 1.45)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 6.6
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(RENDER_DIR / "first-courtyard-passage.png")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    clear_scene()
    model = create_interior()
    setup_preview(model)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_DIR / "first-courtyard-passage.blend"))
    bpy.ops.object.select_all(action="DESELECT")
    model.select_set(True)
    bpy.context.view_layer.objects.active = model
    bpy.ops.export_scene.gltf(
        filepath=str(OUT_DIR / "first-courtyard-passage.glb"),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
    )
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
