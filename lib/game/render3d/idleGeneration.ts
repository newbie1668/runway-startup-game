interface IdleTime {
  timeRemaining(): number;
}

export interface IdleGeneration {
  wake(): void;
  dispose(): void;
}

export function createIdleGeneration(
  request: (callback: (deadline: IdleTime) => void) => number,
  cancel: (handle: number) => void,
  hasWork: () => boolean,
  drain: () => void,
): IdleGeneration {
  let pending: number | null = null;
  let disposed = false;
  const wake = (): void => {
    if (disposed || pending !== null || !hasWork()) return;
    pending = request((deadline) => {
      pending = null;
      if (disposed) return;
      if (hasWork() && deadline.timeRemaining() >= 5) drain();
      wake();
    });
  };
  return {
    wake,
    dispose() {
      disposed = true;
      if (pending !== null) cancel(pending);
      pending = null;
    },
  };
}
