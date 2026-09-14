/**
 * Deterministic PRNG. Every random decision in the game flows through here so a
 * save is fully reproducible from its seed: same seed + same inputs = same world,
 * same season, same results. Never use Math.random() anywhere in the engine.
 */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    // Discard the first few draws; mulberry32 is weakly mixed on low seeds.
    for (let i = 0; i < 4; i++) this.next();
  }

  /** Current internal state, for saving a game mid-career. */
  getState(): number {
    return this.state;
  }

  /** Restores a generator to a previously saved state. */
  setState(state: number): void {
    this.state = state >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max], inclusive on both ends. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[this.int(0, items.length - 1)]!;
  }

  /** Picks an index given relative weights. Weights need not sum to 1. */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) throw new Error('Rng.weightedIndex: weights must sum > 0');
    let roll = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i]!;
      if (roll < 0) return i;
    }
    return weights.length - 1;
  }

  pickWeighted<T>(items: readonly T[], weight: (item: T) => number): T {
    return items[this.weightedIndex(items.map(weight))]!;
  }

  /** Normally distributed value (Box-Muller), clamped to +/-3 sigma. */
  gaussian(mean: number, stdDev: number): number {
    const u = 1 - this.next();
    const v = this.next();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + clamp(z, -3, 3) * stdDev;
  }

  /** Fisher-Yates, returns a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

}

export function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
