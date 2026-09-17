import * as THREE from 'three';
import type { BuildJob } from './buildScheduler';
import { createParkCoverJob, createRoadCoverJob, type RoadCoverContext } from './cityBuilder';
import type { BoundsXZ } from './cityIndex';
import type { CoverSelection } from './coverIndex';
import type { CoverJobOptions } from './coverGeometry';
import type { CityData } from './format';
import { createResourcePool } from './sceneResources';
import { retainSceneResources } from './sceneResourceTree';
import { createWaterCoverJob } from './waterCoverJob';

export interface CoverCellReady {
  readonly group: THREE.Group;
  dispose(): void;
}

export interface CoverCellJobOptions extends Omit<CoverJobOptions, 'onReady'> {
  readonly cityData: CityData;
  readonly selection: CoverSelection;
  readonly bounds: BoundsXZ;
  readonly paintMarks: boolean;
  readonly roadContext?: RoadCoverContext;
  onReady(ready: CoverCellReady): void;
}

export function createCoverCellJob(options: CoverCellJobOptions): BuildJob {
  const pool = createResourcePool();
  const root = new THREE.Group();
  let active: BuildJob | null = null;
  let received: THREE.Group | null = null;
  let layer = 0;
  let terminal = false;
  let transferred = false;
  let disposed = false;
  let stepping = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    try {
      root.removeFromParent();
    } finally {
      root.clear();
      pool.dispose();
    }
  };
  const cancel = (): void => {
    if (terminal) return;
    terminal = true;
    try {
      active?.cancel();
    } finally {
      active = null;
      if (!transferred) dispose();
    }
  };
  const receive = (group: THREE.Group | null): void => {
    received = group;
  };
  const nextLayer = (): BuildJob => {
    const args = { ...options, onReady: receive };
    if (layer === 0) return createWaterCoverJob({ ...args, waterIndices: options.selection.water });
    if (layer === 1) return createParkCoverJob({ ...args, parkIndices: options.selection.parks });
    return createRoadCoverJob({ ...args, roadIndices: options.selection.roads });
  };

  return {
    id: options.id,
    generation: options.generation,
    essential: options.essential,
    cancel,
    step() {
      if (terminal) return true;
      if (stepping) throw new Error('Reentrant cover cell step is unsupported');
      stepping = true;
      try {
        if (layer < 3) {
          active ??= nextLayer();
          if (!active.step()) return false;
          active = null;
          if (received) {
            retainSceneResources(pool, received);
            root.add(received);
            received = null;
          }
          layer += 1;
          return false;
        }
        options.onReady({ group: root, dispose });
        transferred = true;
        terminal = true;
        return true;
      } catch (error) {
        try {
          cancel();
        } catch (cleanup) {
          throw new AggregateError([error, cleanup], 'Cover cell and cleanup failed');
        }
        throw error;
      } finally {
        stepping = false;
      }
    },
  };
}
