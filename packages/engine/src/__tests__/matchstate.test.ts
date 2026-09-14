import { describe, expect, it } from 'vitest';
import { Rng } from '../rng/index.js';
import { createWorld } from '../world/index.js';
import { generatePlayer, currentAbility } from '../world/players.js';
import { advancePlayerWeek, isAvailable, resetSeasonStatus, STATUS_TUNING } from '../world/status.js';
import { effectiveness, selectLineup } from '../match/ratings.js';
import { MATCH_TUNING, simulateMatch } from '../match/engine.js';
import { simulateSeason } from '../league/season.js';
import { developPlayer } from '../career/aging.js';

describe('player status', () => {
  it('rules out injured and suspended players', () => {
    const player = generatePlayer(new Rng('avail'), { position: 'CM', potentialTarget: 70, age: 25 });
    expect(isAvailable(player)).toBe(true);

    player.status.injuryMatches = 3;
    expect(isAvailable(player)).toBe(false);
    player.status.injuryMatches = 0;
    player.status.suspensionMatches = 1;
    expect(isAvailable(player)).toBe(false);
  });

  it('recovers fitness and counts down bans week by week', () => {
    const player = generatePlayer(new Rng('recover'), { position: 'CB', potentialTarget: 70, age: 25 });
    player.status.condition = 50;
    player.status.injuryMatches = 2;
    player.status.suspensionMatches = 1;

    advancePlayerWeek(player);
    expect(player.status.condition).toBeGreaterThan(50);
    expect(player.status.injuryMatches).toBe(1);
    expect(player.status.suspensionMatches).toBe(0);

    // Recovery must never overshoot full fitness.
    for (let i = 0; i < 20; i++) advancePlayerWeek(player);
    expect(player.status.condition).toBeLessThanOrEqual(100);
    expect(player.status.injuryMatches).toBe(0);
  });

  it('clears season counters but carries a ban into next season', () => {
    const player = generatePlayer(new Rng('reset'), { position: 'ST', potentialTarget: 70, age: 25 });
    player.status.goals = 14;
    player.status.minutes = 2800;
    player.status.yellowCards = 4;
    player.status.suspensionMatches = 2;

    resetSeasonStatus(player);
    expect(player.status.goals).toBe(0);
    expect(player.status.minutes).toBe(0);
    expect(player.status.yellowCards).toBe(0);
    expect(player.status.suspensionMatches).toBe(2);
    expect(player.status.condition).toBeGreaterThanOrEqual(90);
  });
});

describe('effectiveness', () => {
  it('rates a tired, out-of-form player below a fresh one', () => {
    const player = generatePlayer(new Rng('eff'), { position: 'CM', potentialTarget: 75, age: 26 });
    const fresh = effectiveness(player);

    player.status.condition = 40;
    expect(effectiveness(player)).toBeLessThan(fresh);

    player.status.condition = 100;
    player.status.form = -8;
    player.status.morale = 15;
    expect(effectiveness(player)).toBeLessThan(fresh);
  });

  it('stays within sane bounds at the extremes', () => {
    const player = generatePlayer(new Rng('eff-bounds'), { position: 'CM', potentialTarget: 75, age: 26 });
    player.status.condition = 0;
    player.status.form = -10;
    player.status.morale = 0;
    expect(effectiveness(player)).toBeGreaterThan(0.5);

    player.status.condition = 100;
    player.status.form = 10;
    player.status.morale = 100;
    expect(effectiveness(player)).toBeLessThan(1.3);
  });
});

describe('selectLineup availability', () => {
  it('never picks an injured or suspended player when alternatives exist', () => {
    const world = createWorld({ seed: 'lineup-avail' });
    const club = world.league.clubs[0]!;

    // Rule out the five best players.
    const ranked = [...club.squad].sort((a, b) => currentAbility(b) - currentAbility(a));
    for (const player of ranked.slice(0, 5)) player.status.injuryMatches = 4;

    const lineup = selectLineup(club);
    for (const slot of lineup.slots) expect(isAvailable(slot.player)).toBe(true);
    for (const player of lineup.bench) expect(isAvailable(player)).toBe(true);
    expect(lineup.slots).toHaveLength(11);
  });

  it('still fields a team when almost everyone is unavailable', () => {
    const world = createWorld({ seed: 'lineup-crisis' });
    const club = world.league.clubs[0]!;
    for (const player of club.squad.slice(0, 20)) player.status.injuryMatches = 2;

    const lineup = selectLineup(club);
    expect(lineup.slots).toHaveLength(11);
    expect(new Set(lineup.slots.map((s) => s.player.id)).size).toBe(11);
  });
});

describe('simulateMatch player state', () => {
  it('leaves players untouched unless asked to update them', () => {
    const world = createWorld({ seed: 'no-mutate' });
    const [home, away] = world.league.clubs;
    const before = home!.squad.map((p) => ({ ...p.status }));

    simulateMatch(new Rng('no-mutate'), home!, away!);

    home!.squad.forEach((player, i) => {
      expect(player.status.condition).toBe(before[i]!.condition);
      expect(player.status.minutes).toBe(before[i]!.minutes);
    });
  });

  it('records minutes and drains condition for a real fixture', () => {
    const world = createWorld({ seed: 'mutate' });
    const [home, away] = world.league.clubs;

    simulateMatch(new Rng('mutate'), home!, away!, { updatePlayerState: true });

    const played = home!.squad.filter((p) => p.status.minutes > 0);
    // Eleven starters plus any substitutes used.
    expect(played.length).toBeGreaterThanOrEqual(11);
    expect(played.length).toBeLessThanOrEqual(11 + MATCH_TUNING.maxSubstitutions);

    for (const player of played) {
      expect(player.status.appearances).toBe(1);
      expect(player.status.minutes).toBeLessThanOrEqual(96);
      expect(player.status.condition).toBeLessThan(100);
    }
  });

  it('never makes more substitutions than the rules allow', () => {
    const world = createWorld({ seed: 'subs' });
    const rng = new Rng('subs');
    const [home, away] = world.league.clubs;

    for (let i = 0; i < 40; i++) {
      const result = simulateMatch(rng, home!, away!);
      for (const clubId of [home!.id, away!.id]) {
        const subs = result.events.filter((e) => e.type === 'substitution' && e.clubId === clubId);
        expect(subs.length).toBeLessThanOrEqual(MATCH_TUNING.maxSubstitutions);
        for (const sub of subs) expect(sub.replacementPlayerId).toBeDefined();
      }
    }
  });
});

describe('season player state', () => {
  it('spreads minutes beyond the first eleven and books people', () => {
    const world = createWorld({ seed: 'season-state' });
    simulateSeason(world, new Rng('season-state'), { playerState: true });

    for (const club of world.league.clubs) {
      const used = club.squad.filter((p) => p.status.minutes > 0);
      expect(used.length, `${club.name} players used`).toBeGreaterThan(11);

      for (const player of club.squad) {
        expect(player.status.minutes).toBeGreaterThanOrEqual(0);
        expect(player.status.condition).toBeGreaterThan(0);
        expect(player.status.condition).toBeLessThanOrEqual(100);
        expect(player.status.morale).toBeGreaterThanOrEqual(0);
        expect(player.status.morale).toBeLessThanOrEqual(100);
        expect(Math.abs(player.status.form)).toBeLessThanOrEqual(10);
      }
    }

    const all = [...world.players.values()];
    expect(all.some((p) => p.status.yellowCards > 0)).toBe(true);
    expect(all.some((p) => p.status.injuryMatches > 0)).toBe(true);
  });

  it('bans a player who collects enough yellow cards', () => {
    const world = createWorld({ seed: 'bans' });
    simulateSeason(world, new Rng('bans'), { playerState: true });

    const banned = [...world.players.values()].filter(
      (p) => p.status.yellowCards >= STATUS_TUNING.yellowsPerBan,
    );
    expect(banned.length).toBeGreaterThan(0);
  });
});

describe('development from playing time', () => {
  it('advances a young regular well ahead of one who never plays', () => {
    const seasonMatches = 38;
    const run = (minutes: number) => {
      const rng = new Rng('development-compare');
      const player = generatePlayer(rng, { position: 'CM', potentialTarget: 88, age: 18 });
      const start = currentAbility(player);
      for (let season = 0; season < 4; season++) {
        developPlayer(rng, player, { minutes, seasonMatches, coaching: 1 });
      }
      return currentAbility(player) - start;
    };

    const regular = run(seasonMatches * 90 * 0.8);
    const benched = run(0);

    expect(regular).toBeGreaterThan(benched);
    // The difference has to be big enough to be worth managing.
    expect(regular - benched).toBeGreaterThan(4);
  });

  it('lets better coaching develop a prospect faster', () => {
    const run = (coaching: number) => {
      const rng = new Rng('coaching-compare');
      const player = generatePlayer(rng, { position: 'ST', potentialTarget: 85, age: 19 });
      const start = currentAbility(player);
      for (let season = 0; season < 3; season++) {
        developPlayer(rng, player, { minutes: 2400, seasonMatches: 38, coaching });
      }
      return currentAbility(player) - start;
    };

    expect(run(1.14)).toBeGreaterThan(run(0.88));
  });

  it('declines an ageing player whether they play or not', () => {
    const run = (minutes: number) => {
      const rng = new Rng('decline-compare');
      const player = generatePlayer(rng, { position: 'CB', potentialTarget: 80, age: 33 });
      const start = currentAbility(player);
      for (let season = 0; season < 3; season++) {
        developPlayer(rng, player, { minutes, seasonMatches: 38, coaching: 1 });
      }
      return currentAbility(player) - start;
    };

    expect(run(2800)).toBeLessThan(0);
    expect(run(0)).toBeLessThan(0);
    // Regular football keeps a veteran sharper for longer.
    expect(run(2800)).toBeGreaterThan(run(0));
  });
});
