import { describe, expect, it } from 'vitest';
import { allClubs, COUNTRIES, createWorld } from '../world/index.js';
import { advanceRound, endSeason, isSeasonComplete, managedLeague, startCareer, startNextSeason } from '../career/index.js';

describe('playable countries', () => {
  for (const country of COUNTRIES) {
    it(`${country.label}: a full pyramid of distinct clubs, mostly home-grown`, () => {
      const world = createWorld({ seed: `country-${country.code}`, divisions: 2, nationality: country.code });
      const clubs = allClubs(world);

      expect(world.leagues.map((l) => l.name)).toEqual(country.divisions.slice(0, 2));
      expect(clubs).toHaveLength(40);
      expect(new Set(clubs.map((c) => c.name)).size).toBe(40);
      expect(new Set(clubs.map((c) => c.shortName.length))).toEqual(new Set([3]));
      expect(clubs.every((c) => c.nationality === country.code)).toBe(true);

      const players = clubs.flatMap((c) => c.squad);
      const domestic = players.filter((p) => p.nationality === country.code).length / players.length;
      expect(domestic).toBeGreaterThan(0.4);
      expect(players.every((p) => p.displayName.trim().length > 0)).toBe(true);
    });
  }

  it('plays a career abroad through a season and into the next', () => {
    const career = startCareer({ seed: 'abroad', nationality: 'GER' });
    expect(managedLeague(career).name).toBe('Erste Liga');
    let guard = 0;
    while (!isSeasonComplete(career) && guard++ < 100) advanceRound(career);
    endSeason(career);
    startNextSeason(career);
    expect(career.world.season).toBe(2);
    expect(allClubs(career.world).every((c) => c.squad.length >= 18)).toBe(true);
  });

  it('leaves the Brazilian world exactly as it was', () => {
    const implicit = createWorld({ seed: 'brazil-same', divisions: 2 });
    const explicit = createWorld({ seed: 'brazil-same', divisions: 2, nationality: 'BRA' });
    expect(allClubs(explicit).map((c) => c.name)).toEqual(allClubs(implicit).map((c) => c.name));
  });
});
