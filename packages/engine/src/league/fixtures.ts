import type { Rng } from '../rng/index.js';
import type { Fixture } from '../types.js';

/**
 * Double round-robin schedule via the circle method: every club plays every
 * other club home and away. For n clubs that is 2*(n-1) rounds of n/2 matches.
 */
export function generateFixtures(clubIds: readonly string[], rng?: Rng): Fixture[] {
  if (clubIds.length < 2) throw new Error('generateFixtures: need at least 2 clubs');
  if (clubIds.length % 2 !== 0) throw new Error('generateFixtures: odd club counts are not supported yet');

  // Shuffling first means the fixture list differs between saves.
  const ids = rng ? rng.shuffle(clubIds) : clubIds.slice();
  const n = ids.length;
  const roundsPerHalf = n - 1;
  const half = n / 2;

  const rotation = ids.slice(1);
  const fixed = ids[0]!;
  const firstHalf: Fixture[] = [];

  for (let round = 0; round < roundsPerHalf; round++) {
    // The fixed club alternates venue each round so it is not always at home.
    const fixedAtHome = round % 2 === 0;
    const opponent = rotation[0]!;
    firstHalf.push({
      round: round + 1,
      homeClubId: fixedAtHome ? fixed : opponent,
      awayClubId: fixedAtHome ? opponent : fixed,
    });

    for (let i = 1; i < half; i++) {
      const home = rotation[i]!;
      const away = rotation[rotation.length - i]!;
      // Alternate venue by pairing index too, to even out the home/away split.
      const swap = (round + i) % 2 === 0;
      firstHalf.push({
        round: round + 1,
        homeClubId: swap ? home : away,
        awayClubId: swap ? away : home,
      });
    }

    rotation.unshift(rotation.pop()!);
  }

  // Second half of the season: identical pairings with venues reversed.
  const secondHalf: Fixture[] = firstHalf.map((fixture) => ({
    round: fixture.round + roundsPerHalf,
    homeClubId: fixture.awayClubId,
    awayClubId: fixture.homeClubId,
  }));

  return [...firstHalf, ...secondHalf];
}
