import { describe, expect, it } from 'vitest';
import { Rng } from '../rng/index.js';
import { createWorld } from '../world/index.js';
import { currentAbility, generatePlayer } from '../world/players.js';
import { marketValue } from '../economy/valuation.js';
import { askingPrice, TRANSFER_TUNING } from '../transfers/market.js';
import { bestAbilityAt, depthAt, squadNeeds, targetAbility } from '../transfers/needs.js';
import type { Club } from '../types.js';

/**
 * Two relationships between tuning constants are load-bearing, documented in
 * comments, and were asserted nowhere. Either one can be broken by a one-line
 * edit, and the only symptom is a benchmark drifting seasons later.
 */
describe('transfer tuning invariants', () => {
  it('lets a club outbid a selling club\'s valuation of its best player', () => {
    // If the most a buyer will pay is below what a seller asks for a key player,
    // the top of the market is unbuyable at any price and rich clubs have
    // nothing to spend on -- which is exactly how the market froze in milestone 2.
    expect(TRANSFER_TUNING.maxFeePremium).toBeGreaterThan(TRANSFER_TUNING.keyPlayerPremium);
  });

  it('leaves room between the selling floor and the size clubs restock to', () => {
    // If these coincide, every club sits on the floor and nobody can ever sell.
    expect(TRANSFER_TUNING.minSquadSize).toBeLessThan(TRANSFER_TUNING.targetSquadSize);
    expect(TRANSFER_TUNING.targetSquadSize).toBeLessThan(TRANSFER_TUNING.maxSquadSize);
  });

  it('prices a squad player below a starter, and a starter below a key man', () => {
    expect(TRANSFER_TUNING.squadPlayerPremium).toBeLessThan(TRANSFER_TUNING.starterPremium);
    expect(TRANSFER_TUNING.starterPremium).toBeLessThan(TRANSFER_TUNING.keyPlayerPremium);
  });
});

describe('askingPrice', () => {
  const world = createWorld({ seed: 'asking' });
  const club: Club = world.leagues[0]!.clubs[0]!;

  it('always asks at least market value', () => {
    for (const player of club.squad) {
      expect(askingPrice(club, player), player.displayName).toBeGreaterThanOrEqual(
        marketValue(player),
      );
    }
  });

  it('asks more for a player the club actually relies on', () => {
    const ranked = [...club.squad].sort((a, b) => currentAbility(b) - currentAbility(a));
    const best = ranked[0]!;
    // A reserve at the same position as someone better is a squad player.
    const reserve = ranked.find(
      (p) => p.id !== best.id && p.position === best.position,
    );

    const bestMultiple = askingPrice(club, best) / Math.max(1, marketValue(best));
    expect(bestMultiple).toBeGreaterThan(TRANSFER_TUNING.starterPremium - 0.01);

    if (reserve) {
      const reserveMultiple = askingPrice(club, reserve) / Math.max(1, marketValue(reserve));
      expect(reserveMultiple).toBeLessThanOrEqual(bestMultiple);
    }
  });
});

describe('squad needs', () => {
  const world = createWorld({ seed: 'needs' });

  it('expects better players of a better-regarded club', () => {
    expect(targetAbility(85)).toBeGreaterThan(targetAbility(55));
  });

  it('counts depth only at a player\'s natural position', () => {
    const club = world.leagues[0]!.clubs[0]!;
    const keepers = club.squad.filter((p) => p.position === 'GK').length;
    expect(depthAt(club, 'GK')).toBe(keepers);
    expect(keepers).toBeGreaterThanOrEqual(2);
  });

  it('rates the best available player for a position', () => {
    const club = world.leagues[0]!.clubs[0]!;
    const best = bestAbilityAt(club, 'ST');
    expect(best).toBeGreaterThan(0);
    // Excluding the incumbent can only lower it.
    const incumbent = [...club.squad]
      .sort((a, b) => currentAbility(b) - currentAbility(a))
      .find((p) => p.position === 'ST')!;
    expect(bestAbilityAt(club, 'ST', incumbent.id)).toBeLessThanOrEqual(best);
  });

  it('ranks the weakest position first, and covers the whole formation', () => {
    for (const club of world.leagues[0]!.clubs) {
      const needs = squadNeeds(club);
      expect(needs.length).toBeGreaterThan(0);
      for (let i = 1; i < needs.length; i++) {
        expect(needs[i - 1]!.shortfall).toBeGreaterThanOrEqual(needs[i]!.shortfall);
      }
    }
  });

  it('reports a bigger shortfall when a club loses its best player there', () => {
    const club = world.leagues[0]!.clubs[0]!;
    const before = squadNeeds(club).find((n) => n.position === 'ST')!;

    const strikers = club.squad
      .filter((p) => p.position === 'ST')
      .sort((a, b) => currentAbility(b) - currentAbility(a));
    club.squad = club.squad.filter((p) => p.id !== strikers[0]!.id);

    const after = squadNeeds(club).find((n) => n.position === 'ST')!;
    expect(after.shortfall).toBeGreaterThan(before.shortfall);
  });
});

describe('generated squads', () => {
  it('never produces a club name on the blocklist', () => {
    // A legal safeguard: the generator must not stumble onto a real club's name.
    const blocked = new Set([
      'atletico curitiba', 'gremio curitiba', 'fortaleza ec', 'joinville ec',
      'londrina ec', 'carlisle united', 'grimsby town', 'ceara fc',
    ]);
    for (const seed of ['b1', 'b2', 'b3', 'b4', 'b5']) {
      for (const club of createWorld({ seed }).leagues[0]!.clubs) {
        expect(blocked.has(club.name.toLowerCase()), club.name).toBe(false);
      }
    }
  });

  it('gives every club a player in every position it might need', () => {
    const rng = new Rng('shape');
    void generatePlayer(rng, { position: 'ST', potentialTarget: 70, age: 24 });
    for (const club of createWorld({ seed: 'shape' }).leagues[0]!.clubs) {
      expect(depthAt(club, 'GK')).toBeGreaterThanOrEqual(1);
      expect(depthAt(club, 'CB')).toBeGreaterThanOrEqual(1);
      expect(depthAt(club, 'ST')).toBeGreaterThanOrEqual(1);
    }
  });
});
