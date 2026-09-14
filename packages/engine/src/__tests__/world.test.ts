import { describe, expect, it } from 'vitest';
import { Rng } from '../rng/index.js';
import { abilityIn, POSITION_WEIGHTS, POSITIONS, SQUAD_SHAPE } from '../world/positions.js';
import { developmentFactor, generateAttributes } from '../world/players.js';
import { createWorld } from '../world/index.js';
import { selectLineup } from '../match/ratings.js';

describe('position weights', () => {
  it('sum to 1 for every position so ability stays on the 1-100 scale', () => {
    for (const position of POSITIONS) {
      const total = Object.values(POSITION_WEIGHTS[position]).reduce((a, b) => a + b, 0);
      expect(total, position).toBeCloseTo(1, 6);
    }
  });
});

describe('generateAttributes', () => {
  it('calibrates a player to the requested ability', () => {
    const rng = new Rng('attrs');
    for (const position of POSITIONS) {
      for (const target of [35, 55, 75, 88]) {
        const attributes = generateAttributes(rng, position, target);
        expect(abilityIn(attributes, position), `${position}@${target}`).toBeCloseTo(target, 0);
      }
    }
  });

  it('keeps every attribute inside 1-99', () => {
    const rng = new Rng('bounds');
    const attributes = generateAttributes(rng, 'ST', 90);
    for (const value of Object.values(attributes)) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(99);
    }
  });
});

describe('developmentFactor', () => {
  it('rises to a peak around 28 and declines after', () => {
    expect(developmentFactor(18)).toBeLessThan(developmentFactor(23));
    expect(developmentFactor(23)).toBeLessThan(developmentFactor(28));
    expect(developmentFactor(28)).toBeGreaterThan(developmentFactor(33));
    expect(developmentFactor(33)).toBeGreaterThan(developmentFactor(38));
  });

  it('clamps outside the curve', () => {
    expect(developmentFactor(10)).toBe(developmentFactor(16));
    expect(developmentFactor(50)).toBe(developmentFactor(40));
  });
});

describe('createWorld', () => {
  it('is deterministic for a given seed', () => {
    const a = createWorld({ seed: 'world-test' });
    const b = createWorld({ seed: 'world-test' });
    expect(a.league.clubs.map((c) => c.name)).toEqual(b.league.clubs.map((c) => c.name));
    expect(a.league.clubs[0]!.squad[0]!.attributes).toEqual(b.league.clubs[0]!.squad[0]!.attributes);
  });

  it('gives every club a full, uniquely named squad', () => {
    const world = createWorld({ seed: 'squads' });
    const expectedSize = Object.values(SQUAD_SHAPE).reduce((a, b) => a + b, 0);
    const names = new Set<string>();

    for (const club of world.league.clubs) {
      expect(club.squad).toHaveLength(expectedSize);
      expect(club.squad.filter((p) => p.position === 'GK').length).toBeGreaterThanOrEqual(2);
      names.add(club.name);
    }
    expect(names.size).toBe(world.league.clubs.length);
  });

  it('never repeats a display name anywhere in the league', () => {
    // Two players called "Careca" at different clubs read as a bug the moment
    // they appear together in a scoring chart.
    for (const seed of ['dup-a', 'dup-b', 'dup-c', 'dup-d']) {
      const world = createWorld({ seed });
      const names = [...world.players.values()].map((p) => p.displayName);
      expect(new Set(names).size, `duplicates @ ${seed}`).toBe(names.length);
    }
  });

  it('never generates a player whose potential is below their ability floor', () => {
    const world = createWorld({ seed: 'potential' });
    for (const player of world.players.values()) {
      expect(player.potential).toBeGreaterThanOrEqual(20);
      expect(player.potential).toBeLessThanOrEqual(99);
      expect(player.age).toBeGreaterThanOrEqual(16);
      expect(player.age).toBeLessThanOrEqual(38);
    }
  });
});

describe('selectLineup', () => {
  it('fields 11 distinct players with a keeper in goal', () => {
    const world = createWorld({ seed: 'lineup' });
    for (const club of world.league.clubs) {
      const lineup = selectLineup(club);
      expect(lineup.slots).toHaveLength(11);
      expect(new Set(lineup.slots.map((s) => s.player.id)).size).toBe(11);
      // A natural keeper should always win the GK slot over any outfielder.
      expect(lineup.goalkeeper.player.position).toBe('GK');
    }
  });
});
