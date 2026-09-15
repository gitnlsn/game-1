import type { Club, Player, World } from '../types.js';

/**
 * The only places a squad changes.
 *
 * Squad membership used to be the single source of truth, which made "which
 * club is this player at" an O(n) scan of every squad in the world and left
 * nowhere to record that a player is somewhere other than where he is owned.
 * `Player.clubId` fixes both, at the cost of a second thing that can go stale --
 * so every mutation goes through here, and `squadsAreConsistent` exists to prove
 * they still agree.
 */

export function joinSquad(club: Club, player: Player): void {
  club.squad.push(player);
  player.clubId = club.id;
}

/** Takes a player out of a squad. He belongs to nobody until someone takes him. */
export function leaveSquad(club: Club, playerId: string): Player | undefined {
  const index = club.squad.findIndex((player) => player.id === playerId);
  if (index < 0) return undefined;

  const [player] = club.squad.splice(index, 1);
  if (player) player.clubId = undefined;
  return player;
}

export function moveSquad(from: Club, to: Club, player: Player): void {
  leaveSquad(from, player.id);
  joinSquad(to, player);
}

/**
 * Replaces a squad wholesale. Anyone dropped is released rather than left
 * pointing at a club he is no longer in.
 */
export function setSquad(club: Club, players: readonly Player[]): void {
  const keeping = new Set(players.map((player) => player.id));
  for (const player of club.squad) {
    if (!keeping.has(player.id)) player.clubId = undefined;
  }
  club.squad = [...players];
  for (const player of club.squad) player.clubId = club.id;
}

/** Every player a club owns, including the ones it has lent out. */
export function ownedBy(world: World, clubId: string): Player[] {
  const club = world.leagues.flatMap((l) => l.clubs).find((c) => c.id === clubId);
  const onLoan = world.loans
    .filter((loan) => loan.parentClubId === clubId)
    .map((loan) => world.players.get(loan.playerId))
    .filter((player): player is Player => player !== undefined);

  return [...(club?.squad ?? []).filter((p) => !isOnLoanAt(world, p.id)), ...onLoan];
}

export function isOnLoanAt(world: World, playerId: string): boolean {
  return world.loans.some((loan) => loan.playerId === playerId);
}

/**
 * Checks the two records of where a player is still agree.
 *
 * Used by tests rather than by the engine: the point is to catch a new squad
 * mutation that bypassed the helpers above, which is the only way they can
 * drift apart.
 */
export function squadsAreConsistent(world: World): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const league of world.leagues) {
    for (const club of league.clubs) {
      for (const player of club.squad) {
        if (player.clubId !== club.id) {
          problems.push(`${player.id} is in ${club.id}'s squad but says ${player.clubId}`);
        }
        if (seen.has(player.id)) problems.push(`${player.id} is in two squads`);
        seen.add(player.id);
      }
    }
  }

  for (const player of world.freeAgents) {
    if (player.clubId !== undefined) {
      problems.push(`free agent ${player.id} still says ${player.clubId}`);
    }
  }

  return problems;
}
