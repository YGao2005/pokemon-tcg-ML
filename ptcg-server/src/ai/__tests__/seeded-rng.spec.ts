import { SeededRNG } from '../seeded-rng';

describe('SeededRNG', () => {

  it('Same seed produces identical sequence of 100 next() calls', () => {
    const a = new SeededRNG(42);
    const b = new SeededRNG(42);
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 100; i++) {
      seqA.push(a.next());
      seqB.push(b.next());
    }
    expect(seqA).toEqual(seqB);
  });

  it('Different seeds produce different sequences (first 5 values diverge)', () => {
    const a = new SeededRNG(42);
    const b = new SeededRNG(43);
    let anyDiffer = false;
    for (let i = 0; i < 5; i++) {
      if (a.next() !== b.next()) {
        anyDiffer = true;
      }
    }
    expect(anyDiffer).toBe(true);
  });

  it('next() values are always in [0, 1)', () => {
    const r = new SeededRNG(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt(10) stays in [0, 10) across 1000 samples', () => {
    const r = new SeededRNG(123);
    for (let i = 0; i < 1000; i++) {
      const v = r.nextInt(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('nextInt(0) throws', () => {
    const r = new SeededRNG(1);
    expect(() => r.nextInt(0)).toThrow();
  });

  it('nextInt(-1) throws', () => {
    const r = new SeededRNG(1);
    expect(() => r.nextInt(-1)).toThrow();
  });

  it('fork() returns an independent RNG whose first 10 values differ from parent next 10', () => {
    const parent = new SeededRNG(42);
    const child = parent.fork();
    const childSeq: number[] = [];
    const parentSeq: number[] = [];
    for (let i = 0; i < 10; i++) {
      childSeq.push(child.next());
      parentSeq.push(parent.next());
    }
    // The two sequences must not be identical. (They could share an occasional value
    // by chance, but the full 10-element sequences should differ.)
    expect(childSeq).not.toEqual(parentSeq);
  });

  it('fork() is itself reproducible: same parent state → same child stream', () => {
    const a = new SeededRNG(99);
    const b = new SeededRNG(99);
    const childA = a.fork();
    const childB = b.fork();
    for (let i = 0; i < 20; i++) {
      expect(childA.next()).toBe(childB.next());
    }
  });

  it('Two RNGs with the same seed produce identical nextInt sequences', () => {
    const a = new SeededRNG(2026);
    const b = new SeededRNG(2026);
    for (let i = 0; i < 200; i++) {
      expect(a.nextInt(60)).toBe(b.nextInt(60));
    }
  });

  it('Throws on non-finite seed', () => {
    expect(() => new SeededRNG(NaN)).toThrow();
    expect(() => new SeededRNG(Infinity)).toThrow();
  });
});
