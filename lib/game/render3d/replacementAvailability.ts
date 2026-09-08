/** Runtime-only availability for replacement roots after they attach to the scene. */
import * as THREE from 'three';

function hasGeometry(object: THREE.Mesh | THREE.InstancedMesh): boolean {
  const position = object.geometry.getAttribute('position');
  const index = object.geometry.getIndex();
  return !!position && position.count > 0 && (!index || index.count > 0);
}

/** Empty, hidden, and zero-instance roots do not replace ordinary stock. */
export function hasVisibleReplacementGeometry(root: THREE.Object3D): boolean {
  let available = false;
  root.traverseVisible((object) => {
    if (available) return;
    if (object instanceof THREE.InstancedMesh) {
      available = object.count > 0 && hasGeometry(object);
    } else if (object instanceof THREE.Mesh) {
      available = hasGeometry(object);
    }
  });
  return available;
}

/** A throwing or partial attach cannot report replacement availability. */
export function attachVisibleReplacement(
  root: THREE.Object3D,
  attach: (root: THREE.Object3D) => void,
): boolean {
  attach(root);
  return hasVisibleReplacementGeometry(root);
}
