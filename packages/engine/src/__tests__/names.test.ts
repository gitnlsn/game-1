import { describe, expect, it } from 'vitest';
import { Rng } from '../rng/index.js';
import { createWorld } from '../world/index.js';
import { generateName, NAME_POOL_BY_CODE, NAME_POOLS, pickNationality, shirtName } from '../world/names.js';

const brazil = NAME_POOL_BY_CODE.get('BRA')!;

describe('name pools', () => {
  it('has enough names in every country to fill a league without repeating', () => {
    for (const pool of NAME_POOLS) {
      expect(pool.first.length, `${pool.code} forenames`).toBeGreaterThanOrEqual(20);
      expect(pool.last.length, `${pool.code} surnames`).toBeGreaterThanOrEqual(10);
      expect(pool.firstWeights).toHaveLength(pool.first.length);
      expect(pool.lastWeights).toHaveLength(pool.last.length);
    }
  });

  it('only holds capitalised names, so a vandalised Wikidata label cannot slip in', () => {
    const particle = /^(da|das|de|del|della|di|do|dos|du|la|le|van|von|der|den|ter|y)$/;
    for (const pool of NAME_POOLS) {
      for (const name of [...pool.first, ...pool.last, ...pool.pairs]) {
        const words = name.split(' ');
        const ok = words.every((w, i) => (i < words.length - 1 && particle.test(w)) || /^\p{Lu}/u.test(w));
        expect(ok, `${pool.code}: ${name}`).toBe(true);
      }
    }
  });

  it('draws common names more often than rare ones', () => {
    // Silva is the most common Brazilian football surname; a uniform draw
    // would make it as rare as the tail.
    const rng = new Rng('weights');
    const top = brazil.last[0]!;
    const tail = brazil.last[brazil.last.length - 1]!;
    let topCount = 0;
    let tailCount = 0;
    for (let i = 0; i < 5000; i++) {
      const { lastName } = generateName(rng, brazil);
      if (lastName === top) topCount++;
      if (lastName === tail) tailCount++;
    }
    expect(topCount).toBeGreaterThan(tailCount * 3);
  });

  it('gives Brazilians their nicknames, forename pairs and full names', () => {
    const rng = new Rng('brazil-style');
    const names = Array.from({ length: 2000 }, () => generateName(rng, brazil).displayName);
    const initialled = names.filter((n) => /^\p{Lu}\. /u.test(n));
    const single = names.filter((n) => !n.includes(' '));
    expect(initialled).toHaveLength(0);
    expect(single.length / names.length).toBeGreaterThan(0.2);
    expect(single.length / names.length).toBeLessThan(0.45);
  });

  it('never hands out a famous player\'s nickname', () => {
    const rng = new Rng('reserved');
    const reserved = ['Ronaldinho', 'Ronaldo', 'Kaká', 'Neymar', 'Vinícius Júnior', 'Romário'];
    for (let i = 0; i < 20000; i++) {
      expect(reserved).not.toContain(generateName(rng, brazil).displayName);
    }
  });
});

describe('foreign players', () => {
  it('come from where the league really recruits', () => {
    const rng = new Rng('mix');
    const counts = new Map<string, number>();
    for (let i = 0; i < 20000; i++) {
      const code = pickNationality(rng, brazil).code;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    const foreign = 20000 - (counts.get('BRA') ?? 0);
    expect(foreign / 20000).toBeGreaterThan(0.1);
    expect(foreign / 20000).toBeLessThan(0.2);
    // Argentines are Brazil's biggest import; Germans are a rarity.
    expect(counts.get('ARG') ?? 0).toBeGreaterThan((counts.get('GER') ?? 0) * 5);
  });

  it('are mostly Brazilian in a Brazilian league', () => {
    const world = createWorld({ seed: 'nationalities' });
    const players = [...world.players.values()];
    const domestic = players.filter((p) => p.nationality === 'BRA').length;
    expect(domestic / players.length).toBeGreaterThan(0.75);
  });
});

describe('shirtName', () => {
  it('uses the surname where fans do, and the whole name otherwise', () => {
    expect(shirtName({ displayName: 'G. Barbosa', lastName: 'Barbosa' })).toBe('Barbosa');
    expect(shirtName({ displayName: 'Gabriel Barbosa', lastName: 'Barbosa' })).toBe('Barbosa');
    expect(shirtName({ displayName: 'Dudu', lastName: 'Silva' })).toBe('Dudu');
    expect(shirtName({ displayName: 'João Pedro', lastName: 'Silva' })).toBe('João Pedro');
    expect(shirtName({ displayName: 'V. van Dijk', lastName: 'van Dijk' })).toBe('van Dijk');
  });
});
