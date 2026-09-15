import { Rng } from './src/rng/index.js';
import { createWorld, allClubs } from './src/world/index.js';
import { createSeasonState, playRound } from './src/league/season.js';
import { wageBill } from './src/economy/valuation.js';

function measure(cup: boolean, seeds: string[]) {
  let top = 0, total = 0, used = 0, clubs = 0, subs = 0, matches = 0, injured = 0, wages = 0;
  for (const seed of seeds) {
    const world = createWorld({ seed, divisions: 2 });
    const state = createSeasonState(world, new Rng(seed), { cup, playerState: true, economy: true });
    while (state.nextRound <= state.totalRounds) playRound(state);
    for (const r of state.results) { matches++; subs += r.events.filter((e) => e.type === 'substitution').length; }
    for (const club of allClubs(world)) {
      const m = club.squad.map((p) => p.status.minutes).sort((a, b) => b - a);
      top += m.slice(0, 11).reduce((a, b) => a + b, 0);
      total += m.reduce((a, b) => a + b, 0);
      used += club.squad.filter((p) => p.status.appearances > 0).length;
      injured += club.squad.filter((p) => p.status.injuryMatches > 0).length;
      wages += club.finances.season.wages / (wageBill(club.squad) || 1);
      clubs++;
    }
  }
  return {
    topElevenMinuteShare: +((top / total) * 100).toFixed(1),
    playersUsedPerClub: +(used / clubs).toFixed(1),
    subsPerMatch: +(subs / matches).toFixed(2),
    injuredAtEnd: +(injured / clubs).toFixed(2),
    weeksOfWagesPaid: +(wages / clubs).toFixed(1),
  };
}
const seeds = ['a','b','c','d','e','f'];
console.log('league only: ', measure(false, seeds));
console.log('league + cup:', measure(true, seeds));
