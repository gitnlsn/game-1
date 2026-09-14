import { describe, expect, it } from 'vitest';
import { Rng } from '../rng/index.js';
import { createWorld } from '../world/index.js';
import { currentAbility } from '../world/players.js';
import { simulateCareer, simulateCareerSeason } from '../career/career.js';
import { developPlayer, shouldRetire } from '../career/aging.js';
import { generatePlayer } from '../world/players.js';
import { TRANSFER_TUNING } from '../transfers/market.js';
import type { World } from '../types.js';

/** Every invariant that must hold no matter how many seasons have been played. */
function assertWorldIsCoherent(world: World): void {
  const seen = new Map<string, string>();

  for (const club of world.league.clubs) {
    expect(club.squad.length, `${club.name} squad size`).toBeGreaterThanOrEqual(
      TRANSFER_TUNING.minSquadSize - TRANSFER_TUNING.maxDistressReleases,
    );
    expect(club.squad.length, `${club.name} squad size`).toBeLessThanOrEqual(TRANSFER_TUNING.maxSquadSize);

    // A club must always be able to field a goalkeeper.
    expect(club.squad.some((p) => p.position === 'GK'), `${club.name} has a keeper`).toBe(true);

    for (const player of club.squad) {
      // No player may be at two clubs at once.
      expect(seen.has(player.id), `${player.displayName} duplicated`).toBe(false);
      seen.set(player.id, club.id);

      expect(player.contract.wage).toBeGreaterThan(0);
      expect(player.contract.yearsRemaining).toBeGreaterThanOrEqual(0);
      expect(player.age).toBeGreaterThanOrEqual(15);
      expect(player.age).toBeLessThanOrEqual(45);
      expect(currentAbility(player)).toBeGreaterThan(0);
    }
  }

  // Free agents must not also be on a squad.
  for (const player of world.freeAgents) {
    expect(seen.has(player.id), `free agent ${player.displayName} also at a club`).toBe(false);
  }
}

describe('developPlayer', () => {
  it('improves a young player and declines an old one', () => {
    const rng = new Rng('develop');

    const young = generatePlayer(rng, { position: 'AM', potentialTarget: 85, age: 19 });
    const before = currentAbility(young);
    for (let i = 0; i < 4; i++) developPlayer(rng, young);
    expect(currentAbility(young)).toBeGreaterThan(before);
    expect(young.age).toBe(23);

    const old = generatePlayer(rng, { position: 'CB', potentialTarget: 80, age: 32 });
    const oldBefore = currentAbility(old);
    for (let i = 0; i < 4; i++) developPlayer(rng, old);
    expect(currentAbility(old)).toBeLessThan(oldBefore);
  });

  it('never pushes a player past their potential', () => {
    const rng = new Rng('ceiling');
    const player = generatePlayer(rng, { position: 'ST', potentialTarget: 70, age: 17 });
    for (let i = 0; i < 12; i++) developPlayer(rng, player);
    // The curve tops out at 1.0 of potential, with a little noise allowed.
    expect(currentAbility(player)).toBeLessThanOrEqual(player.potential + 3);
  });

  it('takes pace from ageing players while their reading of the game improves', () => {
    const rng = new Rng('physical');
    const player = generatePlayer(rng, { position: 'RW', potentialTarget: 82, age: 29 });
    const pace = player.attributes.pace;
    const composure = player.attributes.composure;

    for (let i = 0; i < 5; i++) developPlayer(rng, player);

    expect(player.attributes.pace).toBeLessThan(pace);
    expect(player.attributes.composure).toBeGreaterThan(composure);
  });

  it('retires everyone eventually', () => {
    const rng = new Rng('retire');
    const player = generatePlayer(rng, { position: 'GK', potentialTarget: 70, age: 41 });
    expect(shouldRetire(rng, player)).toBe(true);
  });
});

describe('simulateCareerSeason', () => {
  it('keeps the world coherent over many seasons', () => {
    const world = createWorld({ seed: 'career-coherent' });
    const rng = new Rng('career-coherent');

    for (let season = 0; season < 15; season++) {
      simulateCareerSeason(world, rng);
      assertWorldIsCoherent(world);
    }
  });

  it('conserves money across every transfer', () => {
    const world = createWorld({ seed: 'career-money' });
    const rng = new Rng('career-money');
    const clubById = new Map(world.league.clubs.map((c) => [c.id, c]));

    for (let season = 0; season < 8; season++) {
      const before = new Map(world.league.clubs.map((c) => [c.id, c.finances.balance]));
      const summary = simulateCareerSeason(world, rng);

      // Fees must net to zero across the league: every unit a buyer pays is a
      // unit a seller receives.
      const paid = summary.transfers.reduce((sum, t) => sum + t.fee, 0);
      const purchases = world.league.clubs.reduce((s, c) => s + c.finances.season.playerPurchases, 0);
      const sales = world.league.clubs.reduce((s, c) => s + c.finances.season.playerSales, 0);

      expect(purchases).toBe(sales);
      expect(purchases).toBe(paid);

      for (const transfer of summary.transfers) {
        if (transfer.free) {
          expect(transfer.fee).toBe(0);
          expect(transfer.fromClubId).toBe('');
        } else {
          expect(clubById.has(transfer.fromClubId)).toBe(true);
        }
        expect(clubById.has(transfer.toClubId)).toBe(true);
        expect(transfer.wage).toBeGreaterThan(0);
      }
      expect(before.size).toBe(world.league.clubs.length);
    }
  });

  it('keeps playing a coherent league season after season', () => {
    const world = createWorld({ seed: 'career-league' });
    const rng = new Rng('career-league');
    const summaries = simulateCareer(world, rng, { seasons: 10 });

    expect(summaries).toHaveLength(10);
    for (const summary of summaries) {
      expect(summary.table).toHaveLength(20);
      for (const row of summary.table) expect(row.played).toBe(38);
      expect(summary.championName).not.toBe('');
      expect(summary.topScorer?.goals ?? 0).toBeGreaterThan(5);
      // Squads must be restocked as players retire.
      expect(summary.youthPromoted).toBeGreaterThan(0);
    }
  });

  it('is reproducible from a seed', () => {
    const run = () => {
      const world = createWorld({ seed: 'career-repro' });
      const summaries = simulateCareer(world, new Rng('career-repro'), { seasons: 5 });
      return summaries.map((s) => `${s.championName}:${s.table[0]!.points}:${s.transfers.length}`);
    };
    expect(run()).toEqual(run());
  });
});
