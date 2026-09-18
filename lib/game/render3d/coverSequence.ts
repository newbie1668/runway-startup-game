import { dequantizeX, dequantizeY } from './format';

export interface CoverSequence<T> extends Iterable<T> {
  readonly length: number;
  at(index: number): T | undefined;
}

const CAPACITY = 256;
type Page<T> =
  | { kind: 'leaf'; values: Array<T | undefined> }
  | { kind: 'branch'; children: Array<Page<T> | undefined> };

export class CoverPages<T> implements CoverSequence<T> {
  private root: Page<T> = { kind: 'leaf', values: [] };
  private capacity = CAPACITY;
  private count = 0;

  get length(): number {
    return this.count;
  }

  push(value: T): void {
    if (this.count === this.capacity) {
      const children: Array<Page<T> | undefined> = [];
      children[0] = this.root;
      this.root = { kind: 'branch', children };
      this.capacity *= CAPACITY;
    }
    let page = this.root;
    let capacity = this.capacity;
    let offset = this.count;
    while (page.kind === 'branch') {
      capacity /= CAPACITY;
      const index = Math.floor(offset / capacity);
      offset %= capacity;
      let child = page.children[index];
      if (!child) {
        child =
          capacity === CAPACITY ? { kind: 'leaf', values: [] } : { kind: 'branch', children: [] };
        page.children[index] = child;
      }
      page = child;
    }
    page.values[offset] = value;
    this.count++;
  }

  at(index: number): T | undefined {
    if (index < 0) index += this.count;
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return undefined;
    let page = this.root;
    let capacity = this.capacity;
    while (page.kind === 'branch') {
      capacity /= CAPACITY;
      const next = page.children[Math.floor(index / capacity)];
      if (!next) throw new Error('Missing cover sequence page');
      page = next;
      index %= capacity;
    }
    return page.values[index];
  }

  *[Symbol.iterator](): Generator<T> {
    for (let index = 0; index < this.count; index++) yield this.at(index)!;
  }
}

export function sourcePointSequence(
  source: Uint16Array,
): CoverSequence<Readonly<{ x: number; z: number }>> {
  const length = source.length / 2;
  return Object.freeze({
    length,
    at(index: number) {
      if (index < 0) index += length;
      if (!Number.isInteger(index) || index < 0 || index >= length) return undefined;
      return Object.freeze({
        x: dequantizeX(source[index * 2]!),
        z: dequantizeY(source[index * 2 + 1]!),
      });
    },
    *[Symbol.iterator]() {
      for (let index = 0; index < length; index++) yield this.at(index)!;
    },
  });
}
