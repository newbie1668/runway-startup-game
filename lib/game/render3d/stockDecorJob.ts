import {
  buildFacadeSigns,
  buildRooftopMesh,
  buildWindowMesh,
  createScratch,
  type CityScratch,
} from './cityBuilder';
import { createCoverJob, type CoverJobOptions } from './coverGeometry';
import { collectSceneResources } from './sceneResourceTree';

const INSTANCE_PAGE = 512;

export function createStockDecorJob(options: CoverJobOptions & { scratch: CityScratch }) {
  return createCoverJob(options, function* (context) {
    for (const kind of ['windows', 'rooftops'] as const) {
      const values = options.scratch[kind];
      const colors =
        kind === 'windows' ? options.scratch.windowColors : options.scratch.rooftopColors;
      const count = Math.floor(values.length / 16);
      for (let offset = 0; offset < count; offset += INSTANCE_PAGE) {
        const end = Math.min(count, offset + INSTANCE_PAGE);
        const scratch = createScratch();
        scratch[kind] = values.slice(offset * 16, end * 16);
        if (kind === 'windows') scratch.windowColors = colors.slice(offset, end);
        else scratch.rooftopColors = colors.slice(offset, end);
        const mesh = kind === 'windows' ? buildWindowMesh(scratch) : buildRooftopMesh(scratch);
        if (mesh) {
          for (const resource of collectSceneResources(mesh)) context.own(resource);
          mesh.computeBoundingBox();
          mesh.computeBoundingSphere();
          mesh.frustumCulled = true;
          context.root.add(mesh);
        }
        yield;
      }
    }
    for (const sign of options.scratch.signs) {
      const scratch = createScratch();
      scratch.signs.push(sign);
      const group = buildFacadeSigns(scratch);
      if (group) {
        for (const resource of collectSceneResources(group)) context.own(resource);
        context.root.add(group);
      }
      yield;
    }
  });
}
