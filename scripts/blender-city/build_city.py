"""Build and render the RUNWAY London diorama.

The scene is deliberately art-directed rather than geographically literal:
eight startup hubs wrap around a recognisable S-bend Thames, with London
landmarks acting as anchors. Everything is generated through bpy so the scene
is deterministic, inspectable, and does not depend on Blender add-ons.

Examples:
  blender -b --factory-startup --python-exit-code 1 \
    --python scripts/blender-city/build_city.py -- --preview

  blender -b --factory-startup --python-exit-code 1 \
    --python scripts/blender-city/build_city.py -- --final
"""

from __future__ import annotations

import bpy
import bmesh
import colorsys
import json
import math
import random
import sys
from pathlib import Path

from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_DIR = SCRIPT_DIR.parent.parent
AUTHORING_DIR = REPO_DIR / "artifacts" / "diorama-authoring"
PUBLIC_DIR = REPO_DIR / "public" / "game" / "diorama"
ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
TOKENS_ONLY = "--tokens-only" in ARGS
FINAL = "--final" in ARGS or TOKENS_ONLY
PREVIEW = "--preview" in ARGS or not FINAL
FOCUS_PREVIEW = None
if "--focus-preview" in ARGS:
    focus_index = ARGS.index("--focus-preview") + 1
    if focus_index < len(ARGS):
        FOCUS_PREVIEW = ARGS[focus_index]
random.seed(20)

STOREY = 3.0
MASTER_CAMERA_LOCATION = Vector((420.0, -690.0, 680.0))
MASTER_TARGET = Vector((0.0, 0.0, 8.0))
FOCUS_CAMERA_DISTANCE = {
    "camden": 190,
    "kingscross": 190,
    "soho": 185,
    "farringdon": 185,
    "shoreditch": 205,
    "londonbridge": 215,
    "canarywharf": 245,
    "battersea": 225,
}

HUBS = {
    "camden": {"name": "CAMDEN", "point": (-100.0, 62.0, 0.0), "accent": "violet"},
    "kingscross": {"name": "KING'S CROSS", "point": (-38.0, 65.0, 0.0), "accent": "steel"},
    "soho": {"name": "SOHO", "point": (-92.0, 22.0, 0.0), "accent": "magenta"},
    "farringdon": {"name": "FARRINGDON", "point": (-30.0, 24.0, 0.0), "accent": "deep_green"},
    "shoreditch": {"name": "SHOREDITCH", "point": (38.0, 40.0, 0.0), "accent": "orange"},
    "londonbridge": {"name": "LONDON BRIDGE", "point": (28.0, -22.0, 0.0), "accent": "market_red"},
    "canarywharf": {"name": "CANARY WHARF", "point": (122.0, 5.0, 0.0), "accent": "steel"},
    "battersea": {"name": "BATTERSEA", "point": (-118.0, -62.0, 0.0), "accent": "brick"},
}


# ---------------------------------------------------------------------------
# Palette and materials
# ---------------------------------------------------------------------------


def srgb(hexcode: str) -> tuple[float, float, float, float]:
    """Push source saturation so AgX lands on the intended palette."""
    value = hexcode.lstrip("#")
    r, g, b = (int(value[i : i + 2], 16) / 255 for i in (0, 2, 4))
    hue, saturation, brightness = colorsys.rgb_to_hsv(r, g, b)
    r, g, b = colorsys.hsv_to_rgb(
        hue, min(1.0, saturation * 1.28), min(1.0, brightness * 1.01)
    )
    return (r, g, b, 1.0)


PALETTE = {
    "cream": srgb("#f4e8ca"),
    "warm_white": srgb("#fff8e9"),
    "sand": srgb("#d8c39a"),
    "paver": srgb("#c5b18b"),
    "brick": srgb("#b95038"),
    "brick_dark": srgb("#8f3d30"),
    "orange": srgb("#e86c3a"),
    "market_red": srgb("#d9503f"),
    "crane": srgb("#f2c84b"),
    "lawn": srgb("#579e5d"),
    "tree": srgb("#3f8d55"),
    "tree_dark": srgb("#2f7044"),
    "deep_green": srgb("#28644d"),
    "teal": srgb("#2a8c8b"),
    "wise": srgb("#9fe870"),
    "deliveroo": srgb("#00cdbb"),
    "magenta": srgb("#d14f88"),
    "violet": srgb("#7656a8"),
    "steel": srgb("#6686a4"),
    "glass": srgb("#466984"),
    "glass_light": srgb("#8cb4c7"),
    "road": srgb("#34383b"),
    "charcoal": srgb("#20292f"),
    "roof": srgb("#696d70"),
    "water": srgb("#5aafc4"),
    "bus": srgb("#cc2f2f"),
    "apple": srgb("#b9cf58"),
    "skin": srgb("#c99d72"),
    "black": srgb("#161b1e"),
}

MATERIALS: dict[str, bpy.types.Material] = {}


def material(
    key: str, *, roughness: float = 0.56, bevel: float = 0.055, metallic: float = 0.0
) -> bpy.types.Material:
    cache_key = f"{key}:{roughness}:{bevel}:{metallic}"
    if cache_key in MATERIALS:
        return MATERIALS[cache_key]
    result = bpy.data.materials.new(f"clay_{key}_{len(MATERIALS)}")
    result.use_nodes = True
    nodes = result.node_tree.nodes
    links = result.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = PALETTE[key]
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if bevel:
        bevel_node = nodes.new("ShaderNodeBevel")
        bevel_node.samples = 4
        bevel_node.inputs["Radius"].default_value = bevel
        links.new(bevel_node.outputs["Normal"], bsdf.inputs["Normal"])
    MATERIALS[cache_key] = result
    return result


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------


def finalise(mesh: bpy.types.Mesh) -> None:
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.validate()


def mesh_object(
    name: str,
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    mat: bpy.types.Material,
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    finalise(mesh)
    mesh.materials.append(mat)
    result = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(result)
    return result


def box(
    name: str,
    cx: float,
    cy: float,
    z0: float,
    sx: float,
    sy: float,
    sz: float,
    mat: bpy.types.Material,
    rotation: float = 0.0,
) -> bpy.types.Object:
    x0, x1 = -sx / 2, sx / 2
    y0, y1 = -sy / 2, sy / 2
    vertices = [
        (x0, y0, 0),
        (x1, y0, 0),
        (x1, y1, 0),
        (x0, y1, 0),
        (x0, y0, sz),
        (x1, y0, sz),
        (x1, y1, sz),
        (x0, y1, sz),
    ]
    faces = [
        (3, 2, 1, 0),
        (4, 5, 6, 7),
        (0, 1, 5, 4),
        (1, 2, 6, 5),
        (2, 3, 7, 6),
        (3, 0, 4, 7),
    ]
    result = mesh_object(name, vertices, faces, mat)
    result.location = (cx, cy, z0)
    result.rotation_euler[2] = rotation
    return result


def cylinder(
    name: str,
    cx: float,
    cy: float,
    z0: float,
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    *,
    vertices: int = 12,
    rotation: tuple[float, float, float] = (0, 0, 0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=(cx, cy, z0 + depth / 2)
    )
    result = bpy.context.active_object
    result.name = name
    result.rotation_euler = rotation
    result.data.materials.append(mat)
    return result


def tube_between(
    name: str,
    start: tuple[float, float, float],
    end: tuple[float, float, float],
    radius: float,
    mat: bpy.types.Material,
) -> bpy.types.Object:
    start_vector = Vector(start)
    end_vector = Vector(end)
    direction = end_vector - start_vector
    midpoint = (start_vector + end_vector) / 2
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=10,
        radius=radius,
        depth=direction.length,
        location=midpoint,
    )
    result = bpy.context.active_object
    result.name = name
    result.rotation_mode = "QUATERNION"
    result.rotation_quaternion = direction.to_track_quat("Z", "Y")
    result.data.materials.append(mat)
    return result


def cone(
    name: str,
    cx: float,
    cy: float,
    z0: float,
    radius1: float,
    radius2: float,
    depth: float,
    mat: bpy.types.Material,
    *,
    vertices: int = 12,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=(cx, cy, z0 + depth / 2),
    )
    result = bpy.context.active_object
    result.name = name
    result.data.materials.append(mat)
    return result


def ico(
    name: str,
    cx: float,
    cy: float,
    cz: float,
    radius: float,
    mat: bpy.types.Material,
    *,
    squash: float = 1.0,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=radius, location=(cx, cy, cz))
    result = bpy.context.active_object
    result.name = name
    result.scale = (1.0, 1.0, squash)
    result.data.materials.append(mat)
    return result


def torus(
    name: str,
    cx: float,
    cy: float,
    cz: float,
    major_radius: float,
    minor_radius: float,
    mat: bpy.types.Material,
    *,
    rotation: tuple[float, float, float] = (0, 0, 0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=36,
        minor_segments=8,
        location=(cx, cy, cz),
        rotation=rotation,
    )
    result = bpy.context.active_object
    result.name = name
    result.data.materials.append(mat)
    return result


def text3d(
    name: str,
    body: str,
    size: float,
    extrude: float,
    mat: bpy.types.Material,
    location: tuple[float, float, float],
    *,
    rotation: tuple[float, float, float] = (math.radians(90), 0, 0),
    align: str = "CENTER",
) -> bpy.types.Object:
    curve = bpy.data.curves.new(name, type="FONT")
    curve.body = body
    curve.size = size
    curve.extrude = extrude
    curve.bevel_depth = min(0.035, extrude * 0.08)
    curve.align_x = align
    for font_path in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    ):
        try:
            curve.font = bpy.data.fonts.load(font_path)
            break
        except Exception:
            continue
    result = bpy.data.objects.new(name, curve)
    result.location = location
    result.rotation_euler = rotation
    result.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(result)
    return result


def strip_mesh(
    name: str,
    points: list[tuple[float, float]],
    widths: list[float] | float,
    z: float,
    mat: bpy.types.Material,
) -> bpy.types.Object:
    if isinstance(widths, (int, float)):
        widths = [float(widths)] * len(points)
    left: list[tuple[float, float, float]] = []
    right: list[tuple[float, float, float]] = []
    for index, (x, y) in enumerate(points):
        before = Vector(points[max(0, index - 1)])
        after = Vector(points[min(len(points) - 1, index + 1)])
        tangent = (after - before).normalized()
        normal = Vector((-tangent.y, tangent.x))
        half = widths[index] / 2
        left.append((x + normal.x * half, y + normal.y * half, z))
        right.append((x - normal.x * half, y - normal.y * half, z))
    vertices = left + right
    n = len(points)
    # Counter-clockwise from above so open road/river planes receive light.
    faces = [(index, n + index, n + index + 1, index + 1) for index in range(n - 1)]
    return mesh_object(name, vertices, faces, mat)


# ---------------------------------------------------------------------------
# Buildings
# ---------------------------------------------------------------------------


def window_facades(
    name: str,
    cx: float,
    cy: float,
    sx: float,
    sy: float,
    floors: int,
    bays: int,
    height: float,
    glass_key: str = "glass",
) -> None:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []

    def quad(points: list[tuple[float, float, float]]) -> None:
        start = len(vertices)
        vertices.extend(points)
        faces.append((start, start + 1, start + 2, start + 3))

    window_height = min(1.55, height / max(1, floors) * 0.52)
    # South and east facades are the most legible from the master camera.
    for floor in range(floors):
        z0 = floor * height / floors + 0.72
        for bay in range(bays):
            width = sx / bays * 0.55
            center = cx - sx / 2 + sx * (bay + 0.5) / bays
            quad(
                [
                    (center - width / 2, cy - sy / 2 - 0.035, z0),
                    (center + width / 2, cy - sy / 2 - 0.035, z0),
                    (center + width / 2, cy - sy / 2 - 0.035, z0 + window_height),
                    (center - width / 2, cy - sy / 2 - 0.035, z0 + window_height),
                ]
            )
        side_bays = max(2, round(bays * sy / sx))
        for bay in range(side_bays):
            width = sy / side_bays * 0.55
            center = cy - sy / 2 + sy * (bay + 0.5) / side_bays
            quad(
                [
                    (cx + sx / 2 + 0.035, center - width / 2, z0),
                    (cx + sx / 2 + 0.035, center + width / 2, z0),
                    (cx + sx / 2 + 0.035, center + width / 2, z0 + window_height),
                    (cx + sx / 2 + 0.035, center - width / 2, z0 + window_height),
                ]
            )
    mesh_object(name, vertices, faces, material(glass_key, roughness=0.22, bevel=0))


def block_building(
    name: str,
    cx: float,
    cy: float,
    sx: float,
    sy: float,
    floors: int,
    body_key: str,
    *,
    bays: int = 4,
    roof_key: str = "roof",
    parapet: bool = True,
) -> float:
    height = floors * STOREY
    box(f"{name}_body", cx, cy, 0, sx, sy, height, material(body_key))
    window_facades(f"{name}_windows", cx, cy, sx, sy, floors, bays, height)
    if parapet:
        box(
            f"{name}_parapet",
            cx,
            cy,
            height,
            sx + 0.25,
            sy + 0.25,
            0.35,
            material("warm_white"),
        )
    box(
        f"{name}_roof",
        cx,
        cy,
        height + 0.04,
        sx - 0.5,
        sy - 0.5,
        0.25,
        material(roof_key),
    )
    return height


def glass_building(
    name: str,
    cx: float,
    cy: float,
    sx: float,
    sy: float,
    floors: int,
    *,
    crown_key: str = "steel",
) -> float:
    height = floors * STOREY
    box(
        f"{name}_glass",
        cx,
        cy,
        0,
        sx,
        sy,
        height,
        material("glass", roughness=0.17, bevel=0.08),
    )
    for floor in range(floors + 1):
        box(
            f"{name}_band_{floor}",
            cx,
            cy,
            floor * STOREY - 0.08,
            sx + 0.18,
            sy + 0.18,
            0.16,
            material("warm_white", bevel=0.02),
        )
    box(f"{name}_crown", cx, cy, height, sx + 0.35, sy + 0.35, 0.5, material(crown_key))
    return height


def warehouse(
    name: str,
    cx: float,
    cy: float,
    sx: float,
    sy: float,
    *,
    body_key: str = "brick",
    teeth: int = 3,
) -> float:
    height = STOREY * 2
    box(f"{name}_body", cx, cy, 0, sx, sy, height, material(body_key))
    window_facades(f"{name}_windows", cx, cy, sx, sy, 2, 5, height)
    tooth_width = sy / teeth
    for tooth in range(teeth):
        y = cy - sy / 2 + tooth_width * (tooth + 0.5)
        roof = box(
            f"{name}_tooth_{tooth}",
            cx,
            y,
            height,
            sx + 0.2,
            tooth_width * 0.84,
            1.25,
            material("orange"),
        )
        roof.rotation_euler[0] = math.radians(16)
    return height + 1.25


def terrace_row(
    name: str,
    cx: float,
    cy: float,
    count: int,
    *,
    accent: str = "magenta",
) -> None:
    width = 5.2
    for index in range(count):
        x = cx + (index - (count - 1) / 2) * (width + 0.5)
        key = ["cream", "sand", "brick", "warm_white"][index % 4]
        height = block_building(
            f"{name}_{index}", x, cy, width, 8.5, 3, key, bays=2, parapet=False
        )
        box(
            f"{name}_{index}_fascia",
            x,
            cy - 4.35,
            2.0,
            width - 0.35,
            0.25,
            0.75,
            material(accent),
        )
        if index % 2 == 0:
            box(
                f"{name}_{index}_chimney",
                x + 1.35,
                cy + 1.6,
                height,
                0.8,
                0.8,
                2.1,
                material("brick_dark"),
            )


# ---------------------------------------------------------------------------
# Street life
# ---------------------------------------------------------------------------


def tree(name: str, x: float, y: float, scale: float = 1.0) -> None:
    cylinder(f"{name}_trunk", x, y, 0, 0.18 * scale, 1.45 * scale, material("brick_dark"), vertices=7)
    key = "tree" if random.random() > 0.28 else "tree_dark"
    ico(f"{name}_crown", x, y, 2.7 * scale, 1.45 * scale, material(key), squash=1.12)


def minifig(name: str, x: float, y: float, shirt: str | None = None) -> None:
    shirt_key = shirt or random.choice(["orange", "teal", "crane", "magenta", "steel"])
    cylinder(f"{name}_body", x, y, 0, 0.27, 1.05, material(shirt_key), vertices=8)
    ico(f"{name}_head", x, y, 1.35, 0.24, material("skin"))


def car(name: str, x: float, y: float, rotation: float, key: str) -> None:
    body = box(f"{name}_body", 0, 0, 0.24, 3.6, 1.65, 0.7, material(key))
    cabin = box(
        f"{name}_cabin", 0.2, 0, 0.94, 1.8, 1.45, 0.62, material("glass", roughness=0.18)
    )
    for part in (body, cabin):
        local_x = part.location.x
        part.location = (
            x + local_x * math.cos(rotation),
            y + local_x * math.sin(rotation),
            part.location.z,
        )
        part.rotation_euler[2] = rotation


def courier_bike(name: str, x: float, y: float, rotation: float, key: str) -> None:
    def point(local_x: float, local_y: float, local_z: float) -> tuple[float, float, float]:
        return (
            x + local_x * math.cos(rotation) - local_y * math.sin(rotation),
            y + local_x * math.sin(rotation) + local_y * math.cos(rotation),
            local_z,
        )

    wheel_rotation = (math.radians(90), 0, rotation)
    for suffix, local_x in (("rear", -0.95), ("front", 0.95)):
        wheel = point(local_x, 0, 0.78)
        torus(
            f"{name}_{suffix}_wheel",
            *wheel,
            0.68,
            0.09,
            material("charcoal"),
            rotation=wheel_rotation,
        )

    frame = material(key)
    rear = point(-0.95, 0, 0.78)
    front = point(0.95, 0, 0.78)
    crank = point(-0.05, 0, 0.7)
    seat_joint = point(-0.35, 0, 1.45)
    handle_joint = point(0.62, 0, 1.5)
    for index, (start, end) in enumerate(
        (
            (rear, crank),
            (crank, seat_joint),
            (seat_joint, rear),
            (seat_joint, handle_joint),
            (handle_joint, front),
            (crank, handle_joint),
        )
    ):
        tube_between(f"{name}_frame_{index}", start, end, 0.075, frame)

    seat = point(-0.42, 0, 1.55)
    box(f"{name}_seat", *seat[:2], seat[2], 0.5, 0.22, 0.12, material("charcoal"), rotation)
    tube_between(
        f"{name}_handlebar",
        point(0.58, -0.35, 1.58),
        point(0.58, 0.35, 1.58),
        0.06,
        material("steel"),
    )
    rider = point(-0.28, 0, 1.3)
    cylinder(
        f"{name}_courier_body",
        rider[0],
        rider[1],
        rider[2],
        0.27,
        1.05,
        material(key),
        vertices=8,
    )
    head = point(-0.28, 0, 2.62)
    ico(f"{name}_courier_head", *head, 0.24, material("skin"))
    backpack = point(-0.55, 0, 1.55)
    box(
        f"{name}_delivery_pack",
        backpack[0],
        backpack[1],
        backpack[2],
        0.72,
        0.86,
        0.92,
        material("orange"),
        rotation,
    )


def bus(name: str, x: float, y: float, rotation: float) -> None:
    lower = box(f"{name}_lower", 0, 0, 0.25, 7.8, 2.2, 2.0, material("bus"))
    upper = box(f"{name}_upper", 0, 0, 2.25, 7.5, 2.1, 1.75, material("bus"))
    windows = box(
        f"{name}_windows", 0, -1.12, 2.55, 7.1, 0.12, 0.95, material("glass", roughness=0.18)
    )
    for part in (lower, upper, windows):
        part.location.x += x
        part.location.y += y
        part.rotation_euler[2] = rotation


def crowd(name: str, x: float, y: float, count: int, spread_x: float, spread_y: float) -> None:
    for index in range(count):
        minifig(
            f"{name}_{index}",
            x + random.uniform(-spread_x, spread_x),
            y + random.uniform(-spread_y, spread_y),
        )


def road(name: str, points: list[tuple[float, float]], width: float) -> None:
    strip_mesh(name, points, width, 0.295, material("road", bevel=0))


def bridge(name: str, x: float, y: float, length: float, rotation: float = 0.0) -> None:
    box(name, x, y, 0.22, length, 7.0, 0.75, material("sand"), rotation)
    for side in (-3.1, 3.1):
        rail = box(
            f"{name}_rail_{side}", 0, side, 0, length, 0.25, 1.0, material("warm_white")
        )
        rail.location = (x, y, 0.85)
        rail.rotation_euler[2] = rotation


def hub_label(hub_id: str, *, y_offset: float = -12.0) -> None:
    hub = HUBS[hub_id]
    x, y, _ = hub["point"]
    box(
        f"{hub_id}_label_slab",
        x,
        y + y_offset,
        0.18,
        max(19.0, len(hub["name"]) * 2.15),
        4.5,
        0.35,
        material(hub["accent"]),
    )
    text3d(
        f"{hub_id}_label",
        hub["name"],
        2.15,
        0.18,
        material("warm_white"),
        (x, y + y_offset - 0.25, 0.58),
        rotation=(0, 0, 0),
    )


def fill_hub_edges(
    hub_id: str,
    style: str,
    *,
    count: int = 7,
    radius_x: float = 30.0,
    radius_y: float = 19.0,
) -> None:
    x, y, _ = HUBS[hub_id]["point"]
    for index in range(count):
        angle = 2 * math.pi * index / count + 0.18
        bx = x + math.cos(angle) * radius_x
        by = y + math.sin(angle) * radius_y
        sx = random.uniform(8.0, 13.0)
        sy = random.uniform(7.0, 11.0)
        floors = random.randint(2, 5)
        if style == "glass" and index % 2 == 0:
            glass_building(f"{hub_id}_edge_{index}", bx, by, sx, sy, floors + 2)
        elif style == "warehouse" and index % 3 == 0:
            warehouse(f"{hub_id}_edge_{index}", bx, by, sx + 2, sy + 2)
        else:
            key = random.choice(["cream", "sand", "brick", "brick_dark"])
            block_building(f"{hub_id}_edge_{index}", bx, by, sx, sy, floors, key)
    for index in range(13):
        tree(
            f"{hub_id}_tree_{index}",
            x + random.uniform(-radius_x + 3, radius_x - 3),
            y + random.choice((-1, 1)) * random.uniform(radius_y - 2, radius_y + 3),
            random.uniform(0.72, 1.08),
        )


# ---------------------------------------------------------------------------
# Hub art direction
# ---------------------------------------------------------------------------


def build_camden() -> None:
    x, y, _ = HUBS["camden"]["point"]
    fill_hub_edges("camden", "warehouse", count=6)
    # Canal and lock.
    strip_mesh(
        "camden_canal",
        [(x - 35, y + 5), (x - 10, y + 1), (x + 15, y + 3), (x + 34, y - 3)],
        7.0,
        0.12,
        material("water", roughness=0.3, bevel=0),
    )
    box("camden_lock", x + 5, y + 2, 0.2, 7.0, 9.0, 0.35, material("brick_dark"))
    terrace_row("camden_market", x - 3, y + 15, 4, accent="violet")
    venue_height = block_building("camden_venue", x + 11, y - 7, 15, 11, 3, "brick_dark")
    box("camden_rooftop_stage", x + 10, y - 7, venue_height + 0.3, 9, 6, 1.0, material("violet"))
    text3d(
        "camden_gig",
        "TONIGHT",
        1.6,
        0.2,
        material("warm_white"),
        (x + 10, y - 10.1, venue_height + 1.5),
    )
    for index in range(4):
        performer_x = x + 7.5 + index * 1.7
        cylinder(
            f"camden_rooftop_performer_{index}",
            performer_x,
            y - 7,
            venue_height + 1.3,
            0.26,
            1.1,
            material(["orange", "teal", "crane", "magenta"][index]),
            vertices=8,
        )
        ico(
            f"camden_rooftop_head_{index}",
            performer_x,
            y - 7,
            venue_height + 2.65,
            0.25,
            material("skin"),
        )
    crowd("camden_crowd", x + 10, y - 14, 9, 5, 1.8)
    for index, radius in enumerate((1.5, 1.15, 0.8)):
        ico(
            f"camden_incense_wisp_{index}",
            x - 15 + index * 0.8,
            y + 12,
            3.0 + index * 1.7,
            radius,
            material("roof"),
            squash=1.3,
        )
    hub_label("camden", y_offset=-15)


def build_kingscross() -> None:
    x, y, _ = HUBS["kingscross"]["point"]
    fill_hub_edges("kingscross", "warehouse", count=7)
    box("kingscross_plaza", x, y, 0.05, 38, 27, 0.2, material("paver", bevel=0))
    warehouse("granary", x - 7, y + 8, 28, 12, body_key="brick_dark", teeth=4)
    deepmind_height = glass_building("deepmind_shed", x + 13, y - 2, 16, 14, 5)
    text3d(
        "deepmind_wordmark",
        "DEEPMIND",
        2.4,
        0.28,
        material("warm_white"),
        (x + 13, y - 9.2, 9.5),
    )
    strip_mesh(
        "kingscross_canal",
        [(x - 36, y - 19), (x - 5, y - 18), (x + 33, y - 21)],
        7.5,
        0.16,
        material("water", roughness=0.3, bevel=0),
    )
    box("kingscross_canal_boat", x - 8, y - 18, 0.35, 8.5, 2.7, 1.3, material("market_red"), 0.05)
    box("kingscross_boat_cabin", x - 7, y - 18, 1.65, 3.8, 2.2, 1.0, material("cream"), 0.05)
    cylinder(
        "deepmind_robot_base",
        x + 15,
        y - 2,
        deepmind_height + 0.5,
        1.1,
        1.4,
        material("crane"),
        vertices=12,
    )
    cylinder(
        "deepmind_robot_arm",
        x + 15,
        y - 2,
        deepmind_height + 1.6,
        0.55,
        5.5,
        material("orange"),
        vertices=10,
        rotation=(0, math.radians(58), math.radians(-22)),
    )
    ico(
        "deepmind_robot_joint",
        x + 17.2,
        y - 2.9,
        deepmind_height + 4.0,
        0.9,
        material("crane"),
    )
    # Gasholder ring.
    torus(
        "gasholder_top",
        x - 24,
        y - 7,
        14,
        8.5,
        0.42,
        material("charcoal"),
        rotation=(math.radians(90), 0, 0),
    )
    for index in range(10):
        angle = 2 * math.pi * index / 10
        box(
            f"gasholder_post_{index}",
            x - 24 + math.cos(angle) * 8.5,
            y - 7 + math.sin(angle) * 8.5,
            0,
            0.55,
            0.55,
            14,
            material("charcoal"),
        )
    crowd("kingscross_students", x - 1, y - 7, 8, 9, 2)
    hub_label("kingscross", y_offset=-17)


def build_soho() -> None:
    x, y, _ = HUBS["soho"]["point"]
    fill_hub_edges("soho", "terrace", count=6, radius_x=28, radius_y=17)
    terrace_row("soho_terrace_n", x, y + 8, 6, accent="magenta")
    terrace_row("soho_terrace_s", x, y - 4, 5, accent="teal")
    box("soho_marquee", x - 8, y - 9, 2.4, 13, 1.2, 0.8, material("magenta"))
    text3d(
        "soho_screening",
        "SCREENING",
        1.35,
        0.18,
        material("warm_white"),
        (x - 8, y - 9.7, 3.05),
    )
    box("soho_podcast_fascia", x + 11, y - 9, 2.4, 12, 1.1, 0.8, material("teal"))
    text3d(
        "soho_podcast_sign",
        "PODCAST",
        1.35,
        0.18,
        material("warm_white"),
        (x + 11, y - 9.65, 3.05),
    )
    box("soho_espresso_bar", x + 2, y - 12, 0.2, 8, 4.5, 2.2, material("orange"))
    cylinder("soho_espresso_cup", x + 2, y - 12, 2.4, 0.8, 1.3, material("warm_white"), vertices=16)
    crowd("soho_lanyards", x + 9, y - 14, 10, 7, 1.5)
    hub_label("soho", y_offset=-17)


def build_farringdon() -> None:
    x, y, _ = HUBS["farringdon"]["point"]
    fill_hub_edges("farringdon", "warehouse", count=7)
    block_building("farringdon_victorian", x - 9, y + 4, 19, 14, 5, "brick_dark", bays=6)
    glass_building("farringdon_crossrail", x + 12, y + 2, 16, 13, 4)
    box("fintech_plaque", x - 8, y - 3.2, 2.2, 5.2, 0.28, 1.5, material("deep_green"))
    text3d(
        "fintech_text",
        "LEDGER & CO",
        0.75,
        0.12,
        material("crane"),
        (x - 8, y - 3.4, 2.72),
    )
    torus(
        "elizabeth_roundel",
        x + 16,
        y - 8,
        2.6,
        1.8,
        0.28,
        material("magenta"),
        rotation=(math.radians(90), 0, 0),
    )
    box("elizabeth_bar", x + 16, y - 8.25, 2.15, 4.9, 0.25, 0.9, material("steel"))
    for index in range(5):
        courier_bike(
            f"farringdon_bike_{index}",
            x + 2 + index * 3.1,
            y - 12 - (index % 2) * 1.4,
            0,
            "teal",
        )
    hub_label("farringdon", y_offset=-17)


def build_shoreditch() -> None:
    x, y, _ = HUBS["shoreditch"]["point"]
    fill_hub_edges("shoreditch", "warehouse", count=8)
    box("shoreditch_plaza", x, y, 0.05, 40, 29, 0.18, material("paver", bevel=0))
    height = warehouse("shoreditch_hero", x, y + 9, 28, 13, body_key="brick", teeth=4)
    box("monzo_frame", x, y + 2.1, height + 2.9, 17, 0.55, 0.45, material("charcoal"))
    text3d(
        "monzo_wordmark",
        "MONZO",
        3.2,
        0.38,
        material("market_red"),
        (x, y + 1.7, height + 3.25),
    )
    box("wise_lawn", x - 10, y - 7, 0.2, 16, 8, 0.3, material("lawn"))
    text3d(
        "wise_wordmark",
        "WISE",
        3.2,
        0.35,
        material("wise"),
        (x - 10, y - 7, 0.6),
        rotation=(0, 0, math.radians(8)),
    )
    cafe_height = block_building("flat_white_cafe", x + 13, y - 7, 11, 9, 2, "cream")
    cylinder("coffee_cup", x + 13, y - 7, cafe_height, 1.5, 2.1, material("warm_white"), vertices=18)
    crowd("shoreditch_queue", x + 10, y - 13, 8, 5, 1.2)
    text3d(
        "deliveroo_wordmark",
        "DELIVEROO",
        1.5,
        0.2,
        material("deliveroo"),
        (x + 13, y - 11.65, 4.1),
    )
    box("shoreditch_crane_tower", x + 24, y + 10, 0, 1.2, 1.2, 27, material("crane"))
    box("shoreditch_crane_arm", x + 31, y + 10, 26.5, 24, 1.0, 1.0, material("crane"))
    cylinder(
        "shoreditch_crane_cable",
        x + 37,
        y + 10,
        18,
        0.12,
        8.5,
        material("charcoal"),
        vertices=8,
    )
    text3d(
        "shoreditch_pound_hook",
        "£",
        3.8,
        0.35,
        material("crane"),
        (x + 37, y + 9.8, 17.4),
    )
    hub_label("shoreditch", y_offset=-18)


def build_londonbridge() -> None:
    x, y, _ = HUBS["londonbridge"]["point"]
    fill_hub_edges("londonbridge", "terrace", count=7, radius_x=30, radius_y=16)
    # Borough Market canopies.
    for row in range(2):
        for column in range(4):
            bx = x - 13 + column * 8.5
            by = y - 2 + row * 8
            box(
                f"market_stall_{row}_{column}",
                bx,
                by,
                0.2,
                7.2,
                5.7,
                2.2,
                material("cream"),
            )
            roof = box(
                f"market_awning_{row}_{column}",
                bx,
                by,
                2.4,
                7.8,
                6.3,
                0.35,
                material("market_red" if column % 2 else "teal"),
            )
            roof.rotation_euler[0] = math.radians(7 if row else -7)
    crowd("borough_lunch", x, y - 15, 16, 17, 3)
    hub_label("londonbridge", y_offset=-20)


def build_canarywharf() -> None:
    x, y, _ = HUBS["canarywharf"]["point"]
    box("canary_plaza", x, y, 0.06, 62, 43, 0.2, material("paver", bevel=0))
    heights = [12, 16, 21, 15, 10, 18, 13]
    positions = [(-22, 8), (-8, 12), (8, 8), (23, 5), (-15, -10), (3, -10), (20, -12)]
    for index, ((dx, dy), floors) in enumerate(zip(positions, heights)):
        height = glass_building(
            f"canary_tower_{index}",
            x + dx,
            y + dy,
            random.uniform(10, 14),
            random.uniform(10, 14),
            floors,
        )
        if index == 2:
            text3d(
                "revolut_wordmark",
                "REVOLUT",
                2.6,
                0.3,
                material("warm_white"),
                (x + dx, y + dy - 6.3, height - 3),
            )
    cylinder("canary_helipad", x - 7, y + 12, 16 * STOREY + 0.5, 4.0, 0.4, material("deep_green"), vertices=24)
    text3d(
        "canary_helipad_h",
        "H",
        3.0,
        0.12,
        material("warm_white"),
        (x - 7, y + 12, 16 * STOREY + 0.92),
        rotation=(0, 0, 0),
    )
    crowd("canary_suits", x - 2, y - 20, 10, 18, 2)
    hub_label("canarywharf", y_offset=-25)


def build_battersea() -> None:
    x, y, _ = HUBS["battersea"]["point"]
    fill_hub_edges("battersea", "glass", count=6, radius_x=32, radius_y=17)
    station_height = block_building(
        "battersea_station", x, y + 4, 35, 20, 6, "brick_dark", bays=7, parapet=False
    )
    for index, dx in enumerate((-12, -4, 4, 12)):
        cylinder(
            f"battersea_chimney_{index}",
            x + dx,
            y + 4,
            station_height,
            1.7,
            20,
            material("cream"),
            vertices=18,
        )
        cylinder(
            f"battersea_chimney_band_{index}",
            x + dx,
            y + 4,
            station_height + 15,
            1.82,
            3.0,
            material("brick"),
            vertices=18,
        )
    glass_building("apple_campus", x + 25, y - 4, 22, 16, 5, crown_key="apple")
    box("fruit_stand", x + 17, y - 14, 0.2, 8, 5, 2.2, material("crane"))
    for index in range(8):
        ico(
            f"fruit_{index}",
            x + 14.5 + (index % 4) * 1.6,
            y - 15.5 + (index // 4) * 1.5,
            2.8,
            0.55,
            material("apple" if index % 2 else "market_red"),
        )
    box("battersea_riverside_park", x - 25, y - 11, 0.12, 20, 10, 0.25, material("lawn"))
    for index in range(6):
        tree(
            f"battersea_park_tree_{index}",
            x - 32 + (index % 3) * 6,
            y - 14 + (index // 3) * 6,
            0.82,
        )
    box("battersea_park_bench", x - 25, y - 11, 0.42, 5, 1.0, 0.55, material("brick_dark"))
    hub_label("battersea", y_offset=-19)


# ---------------------------------------------------------------------------
# Landmarks
# ---------------------------------------------------------------------------


def big_ben(x: float, y: float) -> None:
    height = 38.0
    box("big_ben_tower", x, y, 0, 6.5, 6.5, height, material("sand"))
    for z in (7, 14, 21, 28):
        box(f"big_ben_band_{z}", x, y, z, 7.1, 7.1, 0.65, material("warm_white"))
    for side, (dx, dy, rotation) in enumerate(
        [(0, -3.35, (math.radians(90), 0, 0)), (3.35, 0, (math.radians(90), 0, math.radians(90)))]
    ):
        torus(
            f"big_ben_clock_{side}",
            x + dx,
            y + dy,
            31.2,
            2.0,
            0.24,
            material("charcoal"),
            rotation=rotation,
        )
    cone("big_ben_roof", x, y, height, 5.0, 0.25, 8.5, material("deep_green"), vertices=8)


def london_eye(x: float, y: float) -> None:
    torus(
        "london_eye_ring",
        x,
        y,
        24,
        15,
        0.55,
        material("warm_white"),
        rotation=(math.radians(90), 0, 0),
    )
    for index in range(16):
        angle = 2 * math.pi * index / 16
        px = x + math.cos(angle) * 15
        pz = 24 + math.sin(angle) * 15
        ico(f"eye_pod_{index}", px, y - 0.5, pz, 0.8, material("glass_light"))
    # A-frame supports.
    for dx in (-8, 8):
        support = box("eye_support", 0, 0, 0, 0.65, 0.65, 26, material("warm_white"))
        support.location = (x + dx / 2, y + 1.5, 0)
        support.rotation_euler[1] = math.radians(-17 if dx < 0 else 17)


def shard(x: float, y: float) -> None:
    vertices = [
        (x - 7, y - 5, 0),
        (x + 7, y - 5, 0),
        (x + 5, y + 5, 0),
        (x - 5, y + 5, 0),
        (x - 1.2, y - 1.0, 59),
        (x + 0.8, y + 1.0, 72),
    ]
    faces = [(0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4), (0, 3, 2, 1)]
    mesh_object("the_shard", vertices, faces, material("glass_light", roughness=0.16, bevel=0))


def gherkin(x: float, y: float) -> None:
    levels = 12
    segments = 16
    vertices: list[tuple[float, float, float]] = []
    for level in range(levels + 1):
        z = level / levels * 43
        t = level / levels
        radius = 3.2 + math.sin(t * math.pi) * 5.8
        if level == levels:
            radius = 0.8
        for segment in range(segments):
            angle = 2 * math.pi * segment / segments + level * 0.12
            vertices.append((x + math.cos(angle) * radius, y + math.sin(angle) * radius, z))
    faces = []
    for level in range(levels):
        for segment in range(segments):
            nxt = (segment + 1) % segments
            a = level * segments + segment
            b = level * segments + nxt
            c = (level + 1) * segments + nxt
            d = (level + 1) * segments + segment
            faces.append((a, b, c, d))
    mesh_object("the_gherkin", vertices, faces, material("glass", roughness=0.18, bevel=0))


def tower_bridge(x: float, y: float) -> None:
    bridge("tower_bridge_deck", x, y, 32, 0)
    for dx in (-9, 9):
        box(f"tower_bridge_tower_{dx}", x + dx, y, 0, 5.5, 7.5, 24, material("sand"))
        cone(
            f"tower_bridge_roof_{dx}",
            x + dx,
            y,
            24,
            4.2,
            0.25,
            6.0,
            material("steel"),
            vertices=8,
        )
    box("tower_bridge_upper", x, y, 17.5, 18, 2.2, 2.2, material("steel"))
    for dx in (-15, 15):
        cone(
            f"tower_bridge_pin_{dx}",
            x + dx,
            y,
            1.0,
            1.1,
            0.2,
            5.0,
            material("warm_white"),
            vertices=8,
        )


# ---------------------------------------------------------------------------
# Scene assembly
# ---------------------------------------------------------------------------


def clear_scene() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    MATERIALS.clear()


def build_city() -> None:
    clear_scene()
    # The postcard plinth.
    box("city_plinth", 0, 0, -4.0, 390, 215, 4.0, material("cream", bevel=0.35))
    box("city_ground", 0, 0, 0, 382, 207, 0.18, material("lawn", bevel=0))

    # Each hub sits on a paved model-making tile. The overlaps deliberately
    # knit into one city while leaving green breathing room between districts.
    for hub_id, hub in HUBS.items():
        x, y, _ = hub["point"]
        pad_x = 64 if hub_id == "canarywharf" else 57
        pad_y = 47 if hub_id in ("canarywharf", "battersea") else 41
        box(
            f"{hub_id}_district_pad",
            x,
            y,
            0.19,
            pad_x,
            pad_y,
            0.02,
            material("paver", bevel=0),
        )

    river_points = [
        (-195, -31),
        (-150, -30),
        (-115, -25),
        (-80, -12),
        (-45, -8),
        (-10, -12),
        (28, -7),
        (65, -12),
        (100, -21),
        (145, -23),
        (195, -17),
    ]
    river_widths = [29, 28, 26, 25, 24, 25, 27, 30, 33, 36, 38]
    strip_mesh(
        "thames",
        river_points,
        river_widths,
        0.22,
        material("water", roughness=0.28, bevel=0),
    )

    # Roads tie the hubs together but remain subordinate to the river.
    road("north_road", [(-175, 44), (-120, 44), (-70, 39), (-20, 43), (40, 39), (95, 30), (165, 26)], 7.2)
    road("central_road", [(-170, 10), (-115, 14), (-70, 16), (-25, 17), (25, 18), (82, 12), (165, 5)], 6.6)
    road("south_road", [(-175, -73), (-120, -66), (-72, -49), (-22, -39), (35, -37), (95, -43), (170, -48)], 7.0)
    road("west_link", [(-115, 88), (-105, 55), (-98, 23), (-107, -12), (-118, -69)], 6.2)
    road("city_link", [(-38, 91), (-34, 64), (-30, 25), (-5, -1), (28, -28), (42, -66)], 6.4)
    road("east_link", [(42, 75), (38, 40), (67, 21), (122, 5), (145, -48)], 6.4)

    bridge("westminster_bridge", -58, -10, 28)
    bridge("london_bridge", 8, -10, 29)
    tower_bridge(58, -12)

    build_camden()
    build_kingscross()
    build_soho()
    build_farringdon()
    build_shoreditch()
    build_londonbridge()
    build_canarywharf()
    build_battersea()

    big_ben(-67, -2)
    london_eye(-43, -12)
    shard(18, -15)
    gherkin(13, 9)

    # Calmer connective tissue outside the hubs.
    connective = [
        (-157, 66),
        (-153, 24),
        (-156, -48),
        (-64, -67),
        (-20, -70),
        (72, -63),
        (105, 65),
        (165, 54),
        (171, 8),
        (160, -61),
        (73, 69),
        (5, 74),
        (-173, 84),
        (-137, 88),
        (-74, 90),
        (35, 88),
        (118, 83),
        (157, 82),
        (-178, -6),
        (-165, -82),
        (-78, -84),
        (-37, -82),
        (8, -87),
        (51, -82),
        (100, -76),
        (148, -81),
        (177, -7),
        (179, 34),
        (15, 4),
        (78, 40),
        (82, -3),
        (-72, 48),
        (-61, -34),
        (-150, -14),
    ]
    for index, (x, y) in enumerate(connective):
        floors = 2 + index % 5
        key = ["cream", "brick", "sand", "warm_white"][index % 4]
        width = 10 + (index % 3) * 2
        depth = 8 + (index % 2) * 2
        block_building(f"connective_{index}", x, y, width, depth, floors, key)
        tree(f"connective_tree_{index}", x + width * 0.7, y - 2, 0.9)

    # Smaller perimeter blocks make the postcard feel inhabited without
    # competing with the eight art-directed hub silhouettes.
    perimeter_infill = [
        (-188, 62),
        (-188, 34),
        (-187, -37),
        (-184, -64),
        (-128, 96),
        (-103, -94),
        (-53, 96),
        (-12, -97),
        (43, 98),
        (72, -95),
        (108, 94),
        (137, -94),
        (185, 68),
        (191, 42),
        (193, 17),
        (190, -32),
        (183, -59),
        (-145, -94),
    ]
    for index, (x, y) in enumerate(perimeter_infill):
        width = 7.5 + (index % 3) * 1.8
        depth = 6.5 + (index % 2) * 1.7
        floors = 2 + index % 3
        key = ["brick", "cream", "sand"][index % 3]
        block_building(f"perimeter_infill_{index}", x, y, width, depth, floors, key, bays=3)
        if index % 2 == 0:
            tree(f"perimeter_infill_tree_{index}", x + width * 0.7, y - 1.5, 0.75)

    # Street movement and a final gag-density pass.
    for index, (x, y, rotation, key) in enumerate(
        [
            (-151, 43, 0, "crane"),
            (-120, 11, 0, "warm_white"),
            (-65, 15, 0, "market_red"),
            (-13, 17, 0, "teal"),
            (75, 13, 0, "orange"),
            (145, 4, 0, "steel"),
            (-150, -69, 0, "apple"),
            (-75, -50, 0, "bus"),
            (66, -41, 0, "warm_white"),
        ]
    ):
        car(f"city_car_{index}", x, y, rotation, key)
    bus("route_55", 4, 39, 0)
    bus("route_390", -84, 15, 0)


def make_camera(name: str, location: Vector, target_point: Vector, lens: float = 85.0) -> bpy.types.Object:
    camera_data = bpy.data.cameras.new(name)
    camera_data.lens = lens
    camera_data.clip_end = 2500
    camera = bpy.data.objects.new(name, camera_data)
    camera.location = location
    bpy.context.scene.collection.objects.link(camera)
    target = bpy.data.objects.new(f"{name}_target", None)
    target.location = target_point
    bpy.context.scene.collection.objects.link(target)
    constraint = camera.constraints.new("TRACK_TO")
    constraint.target = target
    constraint.track_axis = "TRACK_NEGATIVE_Z"
    constraint.up_axis = "UP_Y"
    return camera


def setup_lighting() -> None:
    sun_data = bpy.data.lights.new("warm_model_sun", type="SUN")
    sun_data.energy = 3.15
    sun_data.color = (1.0, 0.88, 0.73)
    sun_data.angle = math.radians(5.5)
    sun = bpy.data.objects.new("warm_model_sun", sun_data)
    sun.rotation_euler = (math.radians(38), 0, math.radians(-48))
    bpy.context.scene.collection.objects.link(sun)

    fill_data = bpy.data.lights.new("soft_fill", type="AREA")
    fill_data.energy = 2200
    fill_data.shape = "DISK"
    fill_data.size = 320
    fill = bpy.data.objects.new("soft_fill", fill_data)
    fill.location = (-100, -180, 420)
    bpy.context.scene.collection.objects.link(fill)

    east_fill_data = bpy.data.lights.new("east_fill", type="AREA")
    east_fill_data.energy = 1800
    east_fill_data.shape = "DISK"
    east_fill_data.size = 260
    east_fill = bpy.data.objects.new("east_fill", east_fill_data)
    east_fill.location = (260, -210, 300)
    bpy.context.scene.collection.objects.link(east_fill)

    world = bpy.data.worlds.new("warm_blue_world")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.52, 0.66, 0.82, 1.0)
    background.inputs["Strength"].default_value = 0.52
    bpy.context.scene.world = world


def configure_cycles(width: int, height: int, samples: int, *, transparent: bool = False) -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    try:
        preferences = bpy.context.preferences.addons["cycles"].preferences
        preferences.compute_device_type = "METAL"
        preferences.get_devices()
        for device in preferences.devices:
            device.use = True
        scene.cycles.device = "GPU"
    except Exception as error:
        print("GPU setup failed, using CPU:", error)
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.04 if not FINAL else 0.025
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    scene.render.film_transparent = transparent
    scene.view_settings.view_transform = "AgX"
    for look in ("AgX - Punchy", "Punchy"):
        try:
            scene.view_settings.look = look
            break
        except Exception:
            continue
    scene.view_settings.exposure = -0.05


def render_to(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    print("WROTE", path)


def camera_manifest(master_camera: bpy.types.Object) -> dict:
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated_camera = master_camera.evaluated_get(depsgraph)
    result = {
        "version": 1,
        "masterAspect": 16 / 9,
        "hubs": {},
    }
    for hub_id, hub in HUBS.items():
        point = Vector(hub["point"]) + Vector((0, 0, 5.5))
        projected = world_to_camera_view(scene, evaluated_camera, point)
        result["hubs"][hub_id] = {
            "name": hub["name"],
            "anchor": {
                "x": round(float(projected.x), 5),
                "y": round(float(1 - projected.y), 5),
            },
            "accent": hub["accent"],
            "focus": {
                "avif": f"/game/diorama/focus/{hub_id}-2560.avif",
                "avifSmall": f"/game/diorama/focus/{hub_id}-1280.avif",
                "webp": f"/game/diorama/focus/{hub_id}-2560.webp",
                "webpSmall": f"/game/diorama/focus/{hub_id}-1280.webp",
            },
        }
    return result


# ---------------------------------------------------------------------------
# Token renders
# ---------------------------------------------------------------------------


def token_camera() -> bpy.types.Object:
    camera_data = bpy.data.cameras.new("token_camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 8.5
    camera = bpy.data.objects.new("token_camera", camera_data)
    camera.location = (8, -11, 9)
    bpy.context.scene.collection.objects.link(camera)
    target = bpy.data.objects.new("token_target", None)
    target.location = (0, 0, 1.5)
    bpy.context.scene.collection.objects.link(target)
    constraint = camera.constraints.new("TRACK_TO")
    constraint.target = target
    constraint.track_axis = "TRACK_NEGATIVE_Z"
    constraint.up_axis = "UP_Y"
    return camera


def token_hq() -> None:
    box("token_hq_base", 0, 0, 0, 4.2, 4.2, 0.7, material("warm_white"))
    box("token_hq_building", 0, 0, 0.7, 2.8, 2.5, 2.6, material("cream"))
    cone("token_hq_roof", 0, 0, 3.3, 2.2, 0.25, 1.5, material("sand"), vertices=4)
    text3d(
        "token_hq_text",
        "HQ",
        1.0,
        0.16,
        material("warm_white"),
        (0, -1.31, 1.55),
    )


def token_rival() -> None:
    box("token_rival", 0, 0, 0, 3.7, 3.7, 3.7, material("violet"))
    box("token_rival_band", 0, -1.87, 1.1, 3.2, 0.16, 0.5, material("warm_white"))


def token_event() -> None:
    box("token_event_base", 0, 0, 0, 4.4, 4.4, 0.55, material("warm_white"))
    cone("token_event_tent", 0, 0, 0.55, 2.6, 0.0, 3.5, material("orange"), vertices=4)
    box("token_event_door", 0, -1.31, 0.55, 0.9, 0.16, 1.65, material("charcoal"))


def token_ring() -> None:
    torus("token_ring", 0, 0, 0.35, 2.6, 0.36, material("crane"))


def render_tokens() -> None:
    token_builders = {
        "hq": token_hq,
        "rival": token_rival,
        "event": token_event,
        "ring": token_ring,
    }
    for token_name, builder in token_builders.items():
        clear_scene()
        builder()
        camera = token_camera()
        bpy.context.scene.camera = camera
        setup_lighting()
        configure_cycles(512, 512, 96 if FINAL else 48, transparent=True)
        render_to(AUTHORING_DIR / "tokens" / f"{token_name}.png")


def main() -> None:
    AUTHORING_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    if TOKENS_ONLY:
        render_tokens()
        return
    build_city()
    setup_lighting()

    master_camera = make_camera("master_camera", MASTER_CAMERA_LOCATION, MASTER_TARGET)
    bpy.context.scene.camera = master_camera
    manifest = camera_manifest(master_camera)
    source_manifest = AUTHORING_DIR / "manifest.source.json"
    source_manifest.write_text(json.dumps(manifest, indent=2) + "\n")

    if FINAL:
        # Adaptive sampling and denoising keep the high-resolution source crisp
        # while preserving the issue's verified 96-sample production loop.
        configure_cycles(5120, 2880, 96)
        render_to(AUTHORING_DIR / "master-5120.png")
        direction = (MASTER_CAMERA_LOCATION - MASTER_TARGET).normalized()
        for hub_id, hub in HUBS.items():
            target = Vector(hub["point"]) + Vector((0, 0, 6.5))
            focus_location = target + direction * FOCUS_CAMERA_DISTANCE[hub_id]
            focus_camera = make_camera(
                f"focus_{hub_id}_camera", focus_location, target, lens=85.0
            )
            bpy.context.scene.camera = focus_camera
            configure_cycles(2560, 2560, 96)
            render_to(AUTHORING_DIR / "focus" / f"{hub_id}-2560.png")
    else:
        if FOCUS_PREVIEW:
            if FOCUS_PREVIEW != "all" and FOCUS_PREVIEW not in HUBS:
                raise ValueError(f"Unknown focus hub: {FOCUS_PREVIEW}")
            direction = (MASTER_CAMERA_LOCATION - MASTER_TARGET).normalized()
            focus_hubs = list(HUBS) if FOCUS_PREVIEW == "all" else [FOCUS_PREVIEW]
            for hub_id in focus_hubs:
                hub = HUBS[hub_id]
                target = Vector(hub["point"]) + Vector((0, 0, 6.5))
                focus_location = target + direction * FOCUS_CAMERA_DISTANCE[hub_id]
                focus_camera = make_camera(
                    f"focus_{hub_id}_camera", focus_location, target, lens=85.0
                )
                bpy.context.scene.camera = focus_camera
                preview_size = 800 if FOCUS_PREVIEW == "all" else 1200
                configure_cycles(preview_size, preview_size, 40 if FOCUS_PREVIEW == "all" else 64)
                render_to(AUTHORING_DIR / f"focus-{hub_id}-preview.png")
        else:
            configure_cycles(1600, 900, 64)
            render_to(AUTHORING_DIR / "master-preview.png")

    bpy.ops.wm.save_as_mainfile(filepath=str(AUTHORING_DIR / "runway-london.blend"))
    if not FOCUS_PREVIEW:
        render_tokens()


main()
