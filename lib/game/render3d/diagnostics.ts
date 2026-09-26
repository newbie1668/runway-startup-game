import type * as THREE from 'three';
import { createBufferLedger } from '../mapDiagnostics';

type DisposableOwner = (THREE.BufferGeometry | THREE.InstancedMesh) & {
  addEventListener(type: 'dispose', listener: () => void): void;
  removeEventListener(type: 'dispose', listener: () => void): void;
};

function arrayOf(attribute: unknown): ArrayBufferLike | null {
  if (!attribute || typeof attribute !== 'object') return null;
  const value = attribute as { array?: { buffer?: ArrayBufferLike }; data?: { array?: { buffer?: ArrayBufferLike } } };
  return value.data?.array?.buffer ?? value.array?.buffer ?? null;
}

function buffersFor(owner: DisposableOwner): ArrayBufferLike[] {
  const geometry = owner as THREE.BufferGeometry;
  const buffers: ArrayBufferLike[] = [];
  const attributes = geometry.attributes ?? {};
  for (const attribute of Object.values(attributes)) {
    const buffer = arrayOf(attribute);
    if (buffer) buffers.push(buffer);
  }
  for (const attribute of Object.values(geometry.morphAttributes ?? {})) {
    for (const item of attribute) {
      const buffer = arrayOf(item);
      if (buffer) buffers.push(buffer);
    }
  }
  const index = arrayOf(geometry.index);
  if (index) buffers.push(index);
  const instanced = owner as THREE.InstancedMesh;
  if (instanced.isInstancedMesh) {
    const matrix = arrayOf(instanced.instanceMatrix);
    const color = arrayOf(instanced.instanceColor);
    if (matrix) buffers.push(matrix);
    if (color) buffers.push(color);
  }
  return buffers;
}

export function createGeometryTracker(): {
  trackTree(root: THREE.Object3D): void;
  bytes(): number;
  clear(): void;
} {
  const ledger = createBufferLedger();
  const listeners = new Map<DisposableOwner, () => void>();
  const track = (owner: DisposableOwner): void => {
    ledger.retain(owner, buffersFor(owner));
    if (listeners.has(owner)) return;
    const listener = () => {
      ledger.release(owner);
      (owner as DisposableOwner).removeEventListener('dispose', listener);
      listeners.delete(owner);
    };
    listeners.set(owner, listener);
    owner.addEventListener('dispose', listener);
  };
  return {
    trackTree(root) {
      root.traverse((object) => {
        const candidate = object as unknown as {
          geometry?: THREE.BufferGeometry;
          isInstancedMesh?: boolean;
        };
        if (candidate.geometry) track(candidate.geometry as DisposableOwner);
        if (candidate.isInstancedMesh) track(object as unknown as DisposableOwner);
      });
    },
    bytes: () => ledger.bytes(),
    clear() {
      for (const [owner, listener] of listeners) owner.removeEventListener('dispose', listener);
      listeners.clear();
      ledger.clear();
    },
  };
}
