export function readonlyValues<T>(values: T[]): readonly T[] {
  return new Proxy(values, {
    set: () => false,
    deleteProperty: () => false,
    defineProperty: () => false,
    setPrototypeOf: () => false,
  });
}
