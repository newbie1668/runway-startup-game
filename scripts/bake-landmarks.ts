/**
 * RUNWAY — bake distinctive London landmark meshes to glTF binary.
 *
 * Run: `pnpm tsx scripts/bake-landmarks.ts`
 *
 * Writes public/map/landmarks/<kind>.glb so the game can load them as static
 * assets (no runtime modelling, no third-party API). Geometry comes from
 * lib/game/render3d/landmarks.ts — re-run this after changing a builder.
 */

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { LANDMARKS } from '../lib/game/geo';
import { build } from '../lib/game/render3d/landmarks';

const OUT_DIR = path.join(process.cwd(), 'public/map/landmarks');

/** three's GLTFExporter reads the merged binary chunk via FileReader (browser-only). */
class NodeFileReader {
  result: ArrayBuffer | null = null;
  onloadend: ((ev: unknown) => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onloadend?.(null);
    });
  }
}
(globalThis as unknown as { FileReader: typeof NodeFileReader }).FileReader = NodeFileReader;

async function exportGlb(root: THREE.Object3D): Promise<ArrayBuffer> {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      if ('map' in mat) (mat as THREE.MeshLambertMaterial).map = null;
      if ('emissiveMap' in mat) (mat as THREE.MeshLambertMaterial).emissiveMap = null;
    }
  });
  const scene = new THREE.Scene();
  scene.add(root);
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, { binary: true });
  if (result instanceof ArrayBuffer) return result;
  throw new Error('GLTFExporter did not return a binary glTF');
}

async function main(): Promise<void> {
  const missingOnly = process.argv.includes('--missing');
  await mkdir(OUT_DIR, { recursive: true });
  const kinds = [...new Set(LANDMARKS.map((l) => l.kind))];
  const written: { kind: string; bytes: number }[] = [];
  for (const kind of kinds) {
    const file = path.join(OUT_DIR, `${kind}.glb`);
    if (missingOnly && existsSync(file)) {
      const kept = await stat(file);
      written.push({ kind, bytes: kept.size });
      console.log(`  ${kind}.glb  kept ${(kept.size / 1024).toFixed(1)} KB`);
      continue;
    }
    const group = build(kind);
    group.name = kind;
    const buf = await exportGlb(group);
    await writeFile(file, Buffer.from(buf));
    written.push({ kind, bytes: buf.byteLength });
    console.log(`  ${kind}.glb  ${(buf.byteLength / 1024).toFixed(1)} KB`);
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    files: written.map((w) => ({ kind: w.kind, file: `${w.kind}.glb`, bytes: w.bytes })),
  };
  await writeFile(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${written.length} landmarks to ${path.relative(process.cwd(), OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
