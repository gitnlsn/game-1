/** Loads a save in a fresh process, plays on, and reports what it found. */
import { readFileSync } from 'node:fs';
import { deserializeCareer } from '../../career/persistence.js';
import {
  advanceRound,
  endSeason,
  isSeasonComplete,
  startNextSeason,
} from '../../career/controller.js';
import { currentAbility } from '../../world/players.js';

const [inPath] = process.argv.slice(2);
const career = deserializeCareer(readFileSync(inPath!, 'utf8'));

const squad = [...career.world.players.values()]
  .map((p) => `${p.id}|${p.displayName}|${currentAbility(p).toFixed(3)}`)
  .sort();
const loaded = {
  players: career.world.players.size,
  rngState: career.rng.getState(),
  resultsHash: career.season.results
    .map((r) => `${r.homeClubId}:${r.home.goals}-${r.away.goals}:${r.awayClubId}`)
    .join(','),
  squadHash: squad.join(','),
};

// Roll into the next season, which is where the academy mints new player ids.
endSeason(career);
startNextSeason(career);
let guard = 0;
while (!isSeasonComplete(career) && guard++ < 60) advanceRound(career);

// Anything the fresh process corrupted shows up here.
const seen = new Set<string>();
const duplicates: string[] = [];
let mismatched = 0;
for (const club of career.world.league.clubs) {
  for (const player of club.squad) {
    if (seen.has(player.id)) duplicates.push(player.id);
    seen.add(player.id);
    if (career.world.players.get(player.id) !== player) mismatched++;
  }
}

process.stdout.write(JSON.stringify({ ...loaded, duplicates, mismatched, season: career.world.season }));
