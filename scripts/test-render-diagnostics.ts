import assert from 'node:assert/strict';

async function main(): Promise<void> {
  const THREE = await import('three');
  const { createGeometryTracker } = await import('../lib/game/render3d/diagnostics');
  const { CityRenderer3D } = await import('../lib/game/render3d/CityRenderer3D');
  const { createMapDiagnostics } = await import('../lib/game/mapDiagnostics');
  (globalThis as unknown as { window: { location: { search: string } } }).window = { location: { search: '' } };

  const geometry = new THREE.BufferGeometry();
  const shared = new ArrayBuffer(48);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(shared), 3));
  geometry.setIndex(new THREE.Uint16BufferAttribute(new Uint16Array(new ArrayBuffer(12)), 1));
  const one = new THREE.Mesh(geometry);
  const two = new THREE.Mesh(geometry);
  const tracker = createGeometryTracker();
  const root = new THREE.Group().add(one, two);
  tracker.trackTree(root);
  assert.equal(tracker.bytes(), 60, 'shared geometry buffers count once');
  geometry.dispose();
  assert.equal(tracker.bytes(), 0, 'geometry dispose releases its owner');

  const interleavedBuffer = new THREE.InterleavedBuffer(new Float32Array(new ArrayBuffer(36)), 3);
  const mixed = new THREE.BufferGeometry();
  mixed.setAttribute('position', new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 0, false));
  mixed.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(shared), 3)];
  const mixedTracker = createGeometryTracker();
  mixedTracker.trackTree(new THREE.Group().add(new THREE.Mesh(mixed)));
  assert.equal(mixedTracker.bytes(), 84, 'interleaved and morph buffers count');
  mixed.dispose();
  assert.equal(mixedTracker.bytes(), 0);

  const instancedGeometry = new THREE.BoxGeometry(1, 1, 1);
  const instanced = new THREE.InstancedMesh(instancedGeometry, new THREE.MeshBasicMaterial(), 2);
  instanced.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(new ArrayBuffer(24)), 3);
  const instancedTracker = createGeometryTracker();
  instancedTracker.trackTree(new THREE.Group().add(instanced));
  const geometryBuffers = new Set<ArrayBufferLike>();
  for (const attribute of Object.values(instancedGeometry.attributes)) geometryBuffers.add(attribute.array.buffer);
  geometryBuffers.add(instancedGeometry.index!.array.buffer);
  geometryBuffers.add(instanced.instanceMatrix.array.buffer);
  geometryBuffers.add(instanced.instanceColor.array.buffer);
  const expected = [...geometryBuffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
  assert.equal(instancedTracker.bytes(), expected, 'instance buffers are tracked separately');
  instanced.dispose();
  const geometryOnly = [...geometryBuffers].filter((buffer) => buffer !== instanced.instanceMatrix.array.buffer && buffer !== instanced.instanceColor.array.buffer).reduce((sum, buffer) => sum + buffer.byteLength, 0);
  assert.equal(instancedTracker.bytes(), geometryOnly);
  instancedGeometry.dispose();
  assert.equal(instancedTracker.bytes(), 0);
  instancedTracker.trackTree(new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry())));
  instancedTracker.clear();
  instancedTracker.clear();

  let clock = 0;
  const reporter = createMapDiagnostics(1, () => clock++);
  reporter.selectMode('3d');
  const fake = {
    disposed: false,
    cityStreamed: true,
    readyNotified: false,
    buildQueue: [
      { id: 'optional:throw', kind: 'cover', essential: false, run: () => { throw new Error('optional'); } },
      { id: 'optional:after', kind: 'cover', essential: false, run: () => undefined },
    ],
    diagnostics: reporter,
    cityGroup: new THREE.Group(),
    geometryTracker: { trackTree: () => undefined },
    onFatal: () => { throw new Error('optional failure called fatal'); },
  } as never;
  reporter.registerJob('optional:throw', false);
  reporter.registerJob('optional:after', false);
  CityRenderer3D.prototype['drainBuildQueue'].call(fake);
  CityRenderer3D.prototype['drainBuildQueue'].call(fake);
  assert.equal(fake.buildQueue.length, 0, 'optional failure allows remaining work');
  assert.equal(reporter.snapshot().failedJobs, 1);
  const beforeDispose = reporter.snapshot();
  reporter.dispose();
  reporter.completeJob('optional:after');
  assert.equal(reporter.snapshot().completedJobs, beforeDispose.completedJobs, 'disposed reporters ignore late job settlement');

  let fatalCalls = 0;
  const essentialReporter = createMapDiagnostics(2, () => clock++);
  essentialReporter.selectMode('3d');
  const essentialFake = {
    disposed: false, cityStreamed: true, readyNotified: false,
    buildQueue: [
      { id: 'essential:throw', kind: 'cover', essential: true, run: () => { throw new Error('essential'); } },
      { id: 'essential:after', kind: 'cover', essential: true, run: () => undefined },
    ], diagnostics: essentialReporter, cityGroup: new THREE.Group(), geometryTracker: { trackTree: () => undefined },
    onFatal: () => { fatalCalls++; },
  } as never;
  essentialReporter.registerJob('essential:throw', true);
  essentialReporter.registerJob('essential:after', true);
  CityRenderer3D.prototype['drainBuildQueue'].call(essentialFake);
  assert.equal(fatalCalls, 1);
  assert.equal(essentialFake.buildQueue.length, 1, 'essential failure stops the queue');

  console.log('render diagnostics: ok');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
