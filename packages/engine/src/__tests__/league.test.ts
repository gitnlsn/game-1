import { describe, expect, it } from 'vitest';
import { Rng } from '../rng/index.js';
import { generateFixtures } from '../league/fixtures.js';
import { buildTable } from '../league/table.js';
import { simulateSeason } from '../league/season.js';
import { simulateMatch } from '../match/engine.js';
import { createWorld } from '../world/index.js';

describe('generateFixtures', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `c${i + 1}`);

  it('schedules a full double round-robin', () => {
    const fixtures = generateFixtures(ids);
    expect(fixtures).toHaveLength(20 * 19); // n*(n-1) matches

    const pairings = new Map<string, number>();
    for (const f of fixtures) {
      expect(f.homeClubId).not.toBe(f.awayClubId);
      const key = `${f.homeClubId}v${f.awayClubId}`;
      pairings.set(key, (pairings.get(key) ?? 0) + 1);
    }
    // Every ordered pairing happens exactly once: one home, one away per pair.
    expect(pairings.size).toBe(20 * 19);
    for (const count of pairings.values()) expect(count).toBe(1);
  });

  it('never schedules a club twice in the same round', () => {
    const fixtures = generateFixtures(ids);
    const byRound = new Map<number, string[]>();
    for (const f of fixtures) {
      const round = byRound.get(f.round) ?? [];
      round.push(f.homeClubId, f.awayClubId);
      byRound.set(f.round, round);
    }
    expect(byRound.size).toBe(38);
    for (const [round, clubs] of byRound) {
      expect(clubs, `round ${round}`).toHaveLength(20);
      expect(new Set(clubs).size, `round ${round}`).toBe(20);
    }
  });

  it('gives every club an equal split of home and away matches', () => {
    const fixtures = generateFixtures(ids);
    const home = new Map<string, number>();
    for (const f of fixtures) home.set(f.homeClubId, (home.get(f.homeClubId) ?? 0) + 1);
    for (const id of ids) expect(home.get(id), id).toBe(19);
  });

  it('schedules an odd division by sitting one club out each round', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const fixtures = generateFixtures(ids);

    // Every pairing still happens exactly twice, once each way.
    for (const home of ids) {
      for (const away of ids) {
        if (home === away) continue;
        const matches = fixtures.filter((f) => f.homeClubId === home && f.awayClubId === away);
        expect(matches, `${home} v ${away}`).toHaveLength(1);
      }
    }

    // And nobody plays twice on the same matchday -- the club drawn against the
    // phantom simply has no fixture that round.
    const rounds = new Map<number, string[]>();
    for (const fixture of fixtures) {
      const played = rounds.get(fixture.round) ?? [];
      played.push(fixture.homeClubId, fixture.awayClubId);
      rounds.set(fixture.round, played);
    }
    for (const [round, played] of rounds) {
      expect(new Set(played).size, `round ${round}`).toBe(played.length);
      expect(played.length, `round ${round}`).toBe(ids.length - 1);
    }
  });

  it('names the competition every fixture belongs to', () => {
    const fixtures = generateFixtures(['a', 'b', 'c', 'd'], undefined, 'l2');
    expect(fixtures.every((f) => f.competitionId === 'l2')).toBe(true);
  });
});

describe('buildTable', () => {
  it('awards 3 points for a win and 1 for a draw', () => {
    const world = createWorld({ seed: 'table', clubCount: 4 });
    const [a, b] = world.leagues[0]!.clubs;
    const results = [
      { homeClubId: a!.id, awayClubId: b!.id,
        home: { clubId: a!.id, goals: 2, shots: 9, shotsOnTarget: 4, possession: 55 },
        away: { clubId: b!.id, goals: 1, shots: 7, shotsOnTarget: 3, possession: 45 },
        events: [] },
      { homeClubId: b!.id, awayClubId: a!.id,
        home: { clubId: b!.id, goals: 0, shots: 6, shotsOnTarget: 2, possession: 48 },
        away: { clubId: a!.id, goals: 0, shots: 8, shotsOnTarget: 1, possession: 52 },
        events: [] },
    ];

    const table = buildTable(world.leagues[0]!.clubs, results);
    const rowA = table.find((r) => r.clubId === a!.id)!;
    const rowB = table.find((r) => r.clubId === b!.id)!;

    expect(rowA.points).toBe(4);
    expect(rowA.won).toBe(1);
    expect(rowA.drawn).toBe(1);
    expect(rowA.goalsFor).toBe(2);
    expect(rowA.goalDifference).toBe(1);
    expect(rowB.points).toBe(1);
    expect(table[0]!.clubId).toBe(a!.id);
  });
});

describe('simulateMatch', () => {
  it('reports stats that agree with the event log', () => {
    const world = createWorld({ seed: 'match-stats' });
    const rng = new Rng('match-stats');
    const [home, away] = world.leagues[0]!.clubs;

    for (let i = 0; i < 200; i++) {
      const result = simulateMatch(rng, home!, away!);
      const homeGoalEvents = result.events.filter((e) => e.type === 'goal' && e.clubId === home!.id);
      const homeShotEvents = result.events.filter((e) => e.type === 'shot' && e.clubId === home!.id);

      expect(result.home.goals).toBe(homeGoalEvents.length);
      expect(result.home.shots).toBe(homeShotEvents.length);
      expect(result.home.goals).toBeLessThanOrEqual(result.home.shotsOnTarget);
      expect(result.home.shotsOnTarget).toBeLessThanOrEqual(result.home.shots);
      expect(result.home.possession + result.away.possession).toBe(100);

      for (const event of result.events) {
        expect(event.minute).toBeGreaterThanOrEqual(1);
        expect(event.minute).toBeLessThanOrEqual(95);
        // An assist can never be credited to the scorer.
        if (event.assistPlayerId) expect(event.assistPlayerId).not.toBe(event.playerId);
      }
    }
  });

  it('gives the stronger side the better record over many matches', () => {
    const world = createWorld({ seed: 'strength' });
    const strong = world.leagues[0]!.clubs[0]!;
    const weak = world.leagues[0]!.clubs[19]!;
    const rng = new Rng('strength-runs');

    let strongWins = 0;
    for (let i = 0; i < 400; i++) {
      // Neutral venue so home advantage is not doing the work.
      const result = simulateMatch(rng, strong, weak, { neutral: true });
      if (result.home.goals > result.away.goals) strongWins++;
    }
    expect(strongWins).toBeGreaterThan(220);
    // ...but never so dominant that upsets stop happening.
    expect(strongWins).toBeLessThan(380);
  });
});

describe('simulateSeason', () => {
  it('is reproducible from a seed', () => {
    const run = () => {
      const world = createWorld({ seed: 'season-repro' });
      return simulateSeason(world, new Rng('season-repro')).table;
    };
    expect(run()).toEqual(run());
  });

  it('produces a coherent table', () => {
    const world = createWorld({ seed: 'season-coherent' });
    const season = simulateSeason(world, new Rng('season-coherent'));

    expect(season.results).toHaveLength(380);
    let points = 0, goalsFor = 0, goalsAgainst = 0;

    for (const row of season.table) {
      expect(row.played).toBe(38);
      expect(row.won + row.drawn + row.lost).toBe(38);
      expect(row.points).toBe(row.won * 3 + row.drawn);
      points += row.points;
      goalsFor += row.goalsFor;
      goalsAgainst += row.goalsAgainst;
    }

    // Goals scored across the league must equal goals conceded.
    expect(goalsFor).toBe(goalsAgainst);
    // 3 points per decisive match, 2 per draw.
    const draws = season.results.filter((r) => r.home.goals === r.away.goals).length;
    expect(points).toBe((380 - draws) * 3 + draws * 2);

    // The table must be sorted.
    for (let i = 1; i < season.table.length; i++) {
      const prev = season.table[i - 1]!;
      const curr = season.table[i]!;
      expect(prev.points >= curr.points).toBe(true);
      if (prev.points === curr.points) {
        expect(prev.goalDifference >= curr.goalDifference).toBe(true);
      }
    }
  });

  it('credits every goal in the scorer list to a real player', () => {
    const world = createWorld({ seed: 'scorers' });
    const season = simulateSeason(world, new Rng('scorers'));
    const totalGoals = season.results.reduce((sum, r) => sum + r.home.goals + r.away.goals, 0);
    const scorerGoals = season.scorers.reduce((sum, s) => sum + s.goals, 0);

    expect(scorerGoals).toBe(totalGoals);
    for (const scorer of season.scorers) {
      expect(world.players.has(scorer.playerId)).toBe(true);
      expect(scorer.clubName).not.toBe('');
    }
    // Keepers should not be topping the scoring charts.
    const topScorer = world.players.get(season.scorers[0]!.playerId)!;
    expect(topScorer.position).not.toBe('GK');
  });
});
