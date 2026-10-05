import { describe, expect, it } from 'vitest';
import { Rng } from '../rng/index.js';
import { simulateMatch } from '../match/engine.js';
import { selectLineup } from '../match/ratings.js';
import { allClubs, createWorld } from '../world/index.js';
import type { TeamSheet } from '../types.js';

const world = createWorld({ seed: 'realism', clubCount: 20 });
const clubs = allClubs(world).slice(0, 20);

describe('an outfielder in goal', () => {
  it('concedes like one', () => {
    const club = clubs[5]!;
    const opponent = clubs[6]!;
    const lineup = selectLineup(club);
    const starters = lineup.slots.map((slot) => slot.player.id);
    const keeperAt = lineup.slots.findIndex((slot) => slot.position === 'GK');
    const strikerAt = lineup.slots.findIndex((slot) => slot.position === 'ST');
    const swapped = [...starters];
    swapped[keeperAt] = starters[strikerAt];
    swapped[strikerAt] = starters[keeperAt];

    const conceded = (order: (string | undefined)[], seed: string) => {
      const sheet: TeamSheet = { clubId: club.id, formation: lineup.formation, starters: order, bench: [] };
      const rng = new Rng(seed);
      const matches = 400;
      let goals = 0;
      for (let i = 0; i < matches; i++) {
        goals += simulateMatch(rng, club, opponent, { homeSheet: sheet }).away.goals;
      }
      return goals / matches;
    };

    const normal = conceded(starters, 'keeper:normal');
    const striker = conceded(swapped, 'keeper:striker');

    // A striker in goal is a disaster, not a slightly worse afternoon.
    expect(normal).toBeLessThan(1.6);
    expect(striker).toBeGreaterThan(3);
  });
});

describe('substitutions', () => {
  it('never take off a player who came off the bench, unless he is hurt', () => {
    const rng = new Rng('realism:subs');
    let resubs = 0;
    for (let i = 0; i < 300; i++) {
      const home = clubs[i % 20]!;
      const away = clubs[(i * 7 + 3) % 20]!;
      if (home === away) continue;
      const result = simulateMatch(rng, home, away);

      const cameOn = new Set<string>();
      const injured = new Set(
        result.events.filter((e) => e.type === 'injury').map((e) => e.playerId),
      );
      for (const event of result.events) {
        if (event.type !== 'substitution') continue;
        if (cameOn.has(event.playerId) && !injured.has(event.playerId)) resubs++;
        if (event.replacementPlayerId) cameOn.add(event.replacementPlayerId);
      }
    }
    expect(resubs).toBe(0);
  });
});
