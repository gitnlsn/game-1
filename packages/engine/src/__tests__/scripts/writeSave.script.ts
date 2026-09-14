/**
 * Writes a save, then exits. Run as its own process by crossProcess.test.ts so
 * the load happens with every module-level global at its initial value -- which
 * is the state every real app launch is in.
 */
import { writeFileSync } from 'node:fs';
import { advanceRound, isSeasonComplete, startCareer } from '../../career/controller.js';
import { serializeCareer } from '../../career/persistence.js';
import { currentAbility } from '../../world/players.js';

const [outPath, seed] = process.argv.slice(2);
const career = startCareer({ seed: seed ?? 'cross-process' });

let guard = 0;
while (!isSeasonComplete(career) && guard++ < 60) advanceRound(career);

const table = career.season.results.map(
  (r) => `${r.homeClubId}:${r.home.goals}-${r.away.goals}:${r.awayClubId}`,
);
const squad = [...career.world.players.values()]
  .map((p) => `${p.id}|${p.displayName}|${currentAbility(p).toFixed(3)}`)
  .sort();

writeFileSync(outPath!, serializeCareer(career));
process.stdout.write(
  JSON.stringify({
    players: career.world.players.size,
    rngState: career.rng.getState(),
    resultsHash: table.join(','),
    squadHash: squad.join(','),
  }),
);
