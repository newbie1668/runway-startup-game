import assert from 'node:assert/strict';
import { createBufferLedger, createMapDiagnostics } from '../lib/game/mapDiagnostics';

let clock = 0;
const make = () => createMapDiagnostics(7, () => clock);
const stock = { mode: '3d' as const, durationMs: 8, stockDrawn: true, stockBuildings: 2, drawCalls: 3, triangles: 4, geometryBytes: 5, textures: 1 };

{
  const d = make(); assert.equal(d.getState(), 'loading');
  d.selectMode('3d'); d.registerJob('ground', true); assert.equal(d.snapshot().pendingEssentialJobs, 1);
  d.recordFrame({ ...stock, stockDrawn: false });
  assert.equal(d.getState(), 'loading'); assert.equal(d.snapshot().stockDrawn, false); d.completeJob('ground');
  assert.equal(d.snapshot().pendingEssentialJobs, 0); d.recordFrame(stock);
  assert.equal(d.getState(), 'ready'); d.recordError('optional', false, new Error('minor')); assert.equal(d.getState(), 'degraded');
  d.registerJob('required', true); assert.equal(d.getState(), 'loading'); d.failJob('required', 'broken');
  assert.equal(d.getState(), 'failed'); d.recordFrame(stock); assert.equal(d.getState(), 'failed'); d.selectMode('2d', 'webgl');
  assert.equal(d.getState(), 'fallback'); const late3d = make(); late3d.selectMode('2d'); late3d.recordFrame(stock); assert.equal(late3d.snapshot().firstUsefulFrameMs, null); late3d.recordFrame({ mode: '2d', durationMs: 3 });
  assert.equal(late3d.snapshot().firstUsefulFrameMs, 0); d.registerJob('late', true); d.recordError('late', true, 'ignored'); d.selectMode('3d');
  const s = d.snapshot(); assert.equal(s.fallbackReason, 'webgl'); assert.equal(s.stockBuildings, null); assert.equal(s.stockDrawn, null);
}
{
  const d = make(); d.selectMode('3d'); d.registerJob('a', true); assert.throws(() => d.registerJob('a', true));
  clock = 10; d.startJob('a'); clock = 25; d.completeJob('a'); d.completeJob('a'); assert.throws(() => d.registerJob('a', true)); d.recordFrame(stock);
  const s = d.snapshot(); assert.equal(s.completedJobs, 1); assert.equal(s.lastJob?.ms, 15); assert.equal(s.slowestJob?.id, 'a');
  for (let i = 0; i < 121; i++) d.recordFrame({ ...stock, durationMs: i });
  assert.equal(d.snapshot().frameP95Ms, 114);
  const copy = d.snapshot(); (copy.errors as unknown as Array<unknown>).length = 0; assert.equal(d.snapshot().errors.length, 0);
  d.dispose(); d.setCamera({ x: 1, y: 2, zoom: 3 }); d.recordFrame(stock); assert.equal(d.getState(), 'disposed');
}
{
  const d = make(); d.selectMode('3d'); d.registerJob('ground', true); d.completeJob('ground'); d.recordFrame(stock); d.recordError('e', false, 'x');
  for (let i = 0; i < 25; i++) d.recordError(`e${i}`, false, `x${i}`);
  const s = d.snapshot(); assert.equal(s.errorCount, 26); assert.equal(s.errors.length, 20); assert.equal(s.errors[0].jobId, 'e5');
}
{
  const a = {}, b = {}, one = new ArrayBuffer(10), two = new ArrayBuffer(5); const l = createBufferLedger();
  l.retain(a, [one, one, two]); l.retain(b, [one]); assert.equal(l.bytes(), 15); l.release(a); assert.equal(l.bytes(), 10);
  l.retain(b, [two]); assert.equal(l.bytes(), 5); l.release(b); assert.equal(l.bytes(), 0); l.release(b); l.clear(); assert.equal(l.bytes(), 0);
}
console.log('map diagnostics checks: ok');
