import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeCity, type CityData } from '../lib/game/render3d/format';
import {
  plannedCrosswalks,
  riverCrossingSpans,
  roadCoverContextSteps,
} from '../lib/game/render3d/cityBuilder';

const raw = readFileSync(join(process.cwd(), 'public/map/london-city.bin'));
const fresh = (): CityData =>
  decodeCity(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

const cpuMs = (run: () => void): number => {
  const start = process.cpuUsage();
  run();
  const used = process.cpuUsage(start);
  return (used.user + used.system) / 1000;
};

const independent = fresh();
let crossings = 0;
let crosswalks = 0;
const independentMs = cpuMs(() => {
  crossings = riverCrossingSpans(independent).length;
  crosswalks = plannedCrosswalks(independent).length;
});

const combined = fresh();
let yields = 0;
let contextCrossings = 0;
let contextCrosswalks = 0;
const combinedMs = cpuMs(() => {
  const steps = roadCoverContextSteps(combined);
  for (;;) {
    const next = steps.next();
    if (next.done) {
      contextCrossings = next.value.crossings.length;
      contextCrosswalks = next.value.crosswalks.length;
      break;
    }
    yields += 1;
  }
});

console.log(
  `independent riverCrossingSpans+plannedCrosswalks: ${independentMs.toFixed(1)} ms CPU ` +
    `(${crossings} crossings, ${crosswalks} crosswalks)`,
);
console.log(
  `roadCoverContextSteps: ${combinedMs.toFixed(1)} ms CPU, ${yields} yields ` +
    `(${contextCrossings} crossings, ${contextCrosswalks} crosswalks)`,
);
