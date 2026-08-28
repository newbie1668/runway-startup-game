"""
Bake noticed-tower GLBs from OSM rings + photo/OSM colours + silhouette bands.

Invoked by bake-noticed.ts:
  blender --background --python scripts/blender_noticed.py -- /path/to/job.json

`bands` / `circular` are computed in TypeScript (noticedFeatures.ts) so Blender
and the three.js fallback baker stay in sync.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector


def argv_after_double_dash() -> list[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.textures):
        for item in list(block):
            block.remove(item)


def lift_wall(wall: tuple[float, float, float], min_l: float = 0.32) -> tuple[float, float, float]:
    mx, mn = max(wall), min(wall)
    l = (mx + mn) / 2
    if l >= min_l:
        return wall
    scale = min_l / max(l, 0.04)
    return (min(1.0, wall[0] * scale), min(1.0, wall[1] * scale), min(1.0, wall[2] * scale))


def transform_ring(
    ring: list[tuple[float, float]], scale: float, yaw_deg: float
) -> list[tuple[float, float]]:
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    rad = math.radians(yaw_deg)
    c, s = math.cos(rad), math.sin(rad)
    out: list[tuple[float, float]] = []
    for x, y in ring:
        dx, dy = (x - cx) * scale, (y - cy) * scale
        out.append((cx + dx * c - dy * s, cy + dx * s + dy * c))
    return out


def circularize(ring: list[tuple[float, float]], n: int = 28) -> list[tuple[float, float]]:
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    r = max(math.hypot(x - cx, y - cy) for x, y in ring)
    return [
        (cx + math.cos((i / n) * math.tau) * r, cy + math.sin((i / n) * math.tau) * r)
        for i in range(n)
    ]


def make_window_image(name: str, wall: tuple[float, float, float], seed: int, glass: bool) -> bpy.types.Image:
    w = 128
    h = 256
    img = bpy.data.images.new(name, width=w, height=h, alpha=False)
    px = [0.0] * (w * h * 4)
    wr, wg, wb = lift_wall(wall)
    col_w, row_h = (12, 10) if glass else (16, 14)
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * 4
            on_mullion = (x % col_w) < 3 or (y % row_h) < 2
            if on_mullion:
                px[i], px[i + 1], px[i + 2] = wr, wg, wb
            else:
                cell = (x // col_w) * 31 + (y // row_h) * 17 + seed
                lit = (cell * 1103515245 + 12345) & 0x7FFFFFFF
                if (lit % 10) > 6:
                    # Daytime sky reflection, not tungsten night glow.
                    px[i], px[i + 1], px[i + 2] = 0.59, 0.66, 0.72
                else:
                    px[i], px[i + 1], px[i + 2] = 0.16, 0.20, 0.26
            px[i + 3] = 1.0
    img.pixels = px
    img.pack()
    return img


def make_material(name: str, wall: tuple[float, float, float], seed: int, glass: bool) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = make_window_image(f"{name}-win", wall, seed, glass)
    tex.location = (-400, 0)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = 0.28 if glass else 0.62
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = 0.22 if glass else 0.02
    return mat


def make_roof_material(name: str, roof: tuple[float, float, float]) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (roof[0], roof[1], roof[2], 1)
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = 0.7
    return mat


def assign_uvs(bm: bmesh.types.BMesh, height: float) -> None:
    uv = bm.loops.layers.uv.verify()
    for face in bm.faces:
        n = face.normal
        if abs(n.z) > 0.85:
            for loop in face.loops:
                loop[uv].uv = (loop.vert.co.x * 0.25, loop.vert.co.y * 0.25)
        else:
            along = Vector((-n.y, n.x, 0.0))
            if along.length < 1e-6:
                along = Vector((1.0, 0.0, 0.0))
            else:
                along.normalize()
            for loop in face.loops:
                v = loop.vert.co
                u = v.x * along.x + v.y * along.y
                loop[uv].uv = (u * 2.2, v.z / max(height, 0.01))


def extrude_solid(
    ring: list[tuple[float, float]],
    z0: float,
    height: float,
    name: str,
) -> bmesh.types.BMesh:
    bm = bmesh.new()
    verts = [bm.verts.new((x, y, z0)) for x, y in ring]
    bm.verts.ensure_lookup_table()
    try:
        face = bm.faces.new(verts)
    except ValueError:
        face = bm.faces.new(list(reversed(verts)))
    bm.faces.ensure_lookup_table()
    if face.normal.z < 0:
        face.normal_flip()
    extruded = bmesh.ops.extrude_face_region(bm, geom=[face])
    top_verts = [g for g in extruded["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=top_verts, vec=(0.0, 0.0, height))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    assign_uvs(bm, z0 + height)
    return bm


def bm_to_object(bm: bmesh.types.BMesh, name: str) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def join_objects(objects: list[bpy.types.Object], name: str) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    objects[0].name = name
    return objects[0]


def export_glb(obj: bpy.types.Object, path: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
    )


def default_bands() -> list[dict]:
    return [
        {"t0": 0.0, "t1": 0.14, "scale": 1.0, "yawDeg": 0},
        {"t0": 0.14, "t1": 0.88, "scale": 0.88, "yawDeg": 0},
        {"t0": 0.88, "t1": 1.0, "scale": 0.62, "yawDeg": 0},
    ]


def build_one(job: dict, out_dir: Path) -> None:
    ring = [(float(p[0]), float(p[1])) for p in job["ring"]]
    height = float(job["heightWorld"])
    wall = tuple(float(c) for c in job["wall"])
    roof = tuple(float(c) for c in job["roof"])
    glass = bool(job.get("glass", True))
    seed = int(job.get("seed", 1))
    name = job["id"]
    if job.get("circular"):
        ring = circularize(ring)
    bands = job.get("bands") or default_bands()

    wall_mat = make_material(f"{name}-wall", wall, seed, glass)
    roof_mat = make_roof_material(f"{name}-roof", roof)

    parts: list[bpy.types.Object] = []
    if height < 0.9 and not job.get("bands"):
        bands = [{"t0": 0.0, "t1": 1.0, "scale": 1.0, "yawDeg": 0}]
    for i, band in enumerate(bands):
        z0 = height * float(band["t0"])
        h = height * (float(band["t1"]) - float(band["t0"]))
        scaled = transform_ring(ring, float(band.get("scale", 1)), float(band.get("yawDeg", 0)))
        solid = extrude_solid(scaled, z0, h, f"{name}-{i}")
        obj = bm_to_object(solid, f"{name}-{i}")
        obj.data.materials.append(wall_mat)
        obj.data.materials.append(roof_mat)
        for poly in obj.data.polygons:
            poly.material_index = 1 if poly.normal.z > 0.6 else 0
        parts.append(obj)

    merged = join_objects(parts, name)
    export_glb(merged, out_dir / f"{name}.glb")
    clear_scene()


def main() -> None:
    args = argv_after_double_dash()
    if not args:
        raise SystemExit("blender_noticed.py: missing job.json path")
    job_path = Path(args[0])
    payload = json.loads(job_path.read_text())
    out_dir = Path(payload["outDir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    clear_scene()
    for building in payload["buildings"]:
        print(f"  blender: {building['id']} ({building.get('shape', 'slab')})")
        build_one(building, out_dir)


if __name__ == "__main__":
    main()
