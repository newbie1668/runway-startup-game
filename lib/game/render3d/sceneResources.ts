export type DisposableResource = { dispose(): void };

export type ResourcePool = {
  retain(resource: DisposableResource): () => void;
  dispose(): void;
};

type Entry = {
  resource: DisposableResource;
  references: number;
};

export function createResourcePool(): ResourcePool {
  let closed = false;
  const entries = new Map<DisposableResource, Entry>();
  const disposed = new WeakSet<DisposableResource>();

  const disposeResource = (resource: DisposableResource): void => {
    if (disposed.has(resource)) return;
    disposed.add(resource);
    resource.dispose();
  };

  const retain = (resource: DisposableResource): (() => void) => {
    if (closed || disposed.has(resource)) {
      if (!disposed.has(resource)) disposeResource(resource);
      return () => undefined;
    }

    const existing = entries.get(resource);
    if (existing) {
      existing.references += 1;
    } else {
      entries.set(resource, { resource, references: 1 });
    }

    let released = false;
    return () => {
      if (released || closed) return;
      released = true;

      const entry = entries.get(resource);
      if (!entry) return;
      entry.references -= 1;
      if (entry.references > 0) return;

      entries.delete(resource);
      disposeResource(entry.resource);
    };
  };

  const dispose = (): void => {
    if (closed) return;
    closed = true;

    const liveResources = [...entries.values()].map(({ resource }) => resource);
    entries.clear();

    const errors: unknown[] = [];
    for (const resource of liveResources) {
      try {
        disposeResource(resource);
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) throw new AggregateError(errors, "Resource disposal failed");
  };

  return { retain, dispose };
}
