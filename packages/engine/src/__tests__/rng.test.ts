import { describe, expect, it } from 'vitest';
import { Rng } from '../rng/index.js';

describe('Rng', () => {
  it('produces identical sequences for the same seed', () => {
    const a = new Rng('seed-1');
    const b = new Rng('seed-1');
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = Array.from({ length: 50 }, () => new Rng('seed-1').next());
    const b = Array.from({ length: 50 }, () => new Rng('seed-2').next());
    expect(a).not.toEqual(b);
  });

  it('stays within bounds', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      const int = rng.int(3, 7);
      expect(int).toBeGreaterThanOrEqual(3);
      expect(int).toBeLessThanOrEqual(7);
    }
  });

  it('respects weights', () => {
    const rng = new Rng('weights');
    let zero = 0;
    for (let i = 0; i < 10000; i++) if (rng.weightedIndex([9, 1]) === 0) zero++;
    expect(zero / 10000).toBeGreaterThan(0.85);
    expect(zero / 10000).toBeLessThan(0.95);
  });

  it('shuffles without losing or duplicating items', () => {
    const rng = new Rng('shuffle');
    const input = Array.from({ length: 20 }, (_, i) => i);
    const shuffled = rng.shuffle(input);
    expect(shuffled).toHaveLength(20);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(input);
    expect(shuffled).not.toEqual(input);
  });
});
