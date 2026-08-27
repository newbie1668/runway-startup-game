"""
Bake noticed-tower GLBs from OSM rings + photo/OSM colours.

Invoked by bake-noticed.ts:
  blender --background --python scripts/blender_noticed.py -- /path/to/job.json
"""

from __future__ import annotations

import json
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


def inset_ring(ring: list[tuple[float, float]], factor: float) -> list[tuple[float, float]]:
    if factor >= 0.98:
        return ring
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    return [(cx + (x - cx) * factor, cy + (y - cy) * factor) for x, y in ring]


def make_window_image(name: str, wall: tuple[float, float, float], seed: int) -> bpy.types.Image:
    w = h = 256
    img = bpy.data.images.new(name, width=w, height=h, alpha=False)
    px = [0.0] * (w * h * 4)
    wr, wg, wb = wall
    col_w, row_h = 16, 12
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * 4
            on_mullion = (x % col_w) < 3 or (y % row_h) < 2
            if on_mullion:
                px[i], px[i + 1], px[i + 2] = wr, wg, wb
            else:
                cell = (x // col_w) * 31 + (y // row_h) * 17 + seed
                lit = (cell * 1103515245 + 12345) & 0x7FFFFFFF
                if (lit % 10) > 5:
                    px[i], px[i + 1], px[i + 2] = 1.0, 0.84, 0.52
                else:
                    px[i], px[i + 1], px[i + 2] = 0.10, 0.14, 0.20
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
    tex.image = make_window_image(f"{name}-win", wall, seed)
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


def build_one(job: dict, out_dir: Path) -> None:
    ring = [(float(p[0]), float(p[1])) for p in job["ring"]]
    height = float(job["heightWorld"])
    wall = tuple(float(c) for c in job["wall"])
    roof = tuple(float(c) for c in job["roof"])
    glass = bool(job.get("glass", True))
    seed = int(job.get("seed", 1))
    name = job["id"]

    wall_mat = make_material(f"{name}-wall", wall, seed, glass)
    roof_mat = make_roof_material(f"{name}-roof", roof)

    parts: list[bpy.types.Object] = []
    # Podium / shaft / crown so tall towers aren't one extruded slab.
    bands = [(0.0, 0.14, 1.0), (0.14, 0.88, 0.88), (0.88, 1.0, 0.62)]
    if height < 0.9:
        bands = [(0.0, 1.0, 1.0)]
    for i, (t0, t1, scale) in enumerate(bands):
        z0 = height * t0
        h = height * (t1 - t0)
        solid = extrude_solid(inset_ring(ring, scale), z0, h, f"{name}-{i}")
        obj = bm_to_object(solid, f"{name}-{i}")
        obj.data.materials.append(wall_mat)
        obj.data.materials.append(roof_mat)
        # Roof faces (upward) get the roof slot.
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
        print(f"  blender: {building['id']}")
        build_one(building, out_dir)


if __name__ == "__main__":
    main()
