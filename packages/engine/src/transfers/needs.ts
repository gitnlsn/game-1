import type { Club, Position } from '../types.js';
import { abilityIn, DEFAULT_FORMATION, FORMATIONS, positionFamiliarity } from '../world/positions.js';

/** The standard of player a club of this reputation expects to field. */
export function targetAbility(reputation: number): number {
  return 30 + reputation * 0.62;
}

/** Best ability any squad member offers in a given position, after familiarity. */
export function bestAbilityAt(club: Club, position: Position, excludeId?: string): number {
  let best = 0;
  for (const player of club.squad) {
    if (player.id === excludeId) continue;
    const ability = abilityIn(player.attributes, position) * positionFamiliarity(player.position, position);
    if (ability > best) best = ability;
  }
  return best;
}

/** How many players a club has who are natural in a position. */
export function depthAt(club: Club, position: Position): number {
  return club.squad.filter((p) => p.position === position).length;
}

export interface SquadNeed {
  position: Position;
  /** Best the club can currently field there. */
  current: number;
  /** How far short of the club's standard that is. Higher means more urgent. */
  shortfall: number;
}

/**
 * Positions where the club falls furthest short of the standard its reputation
 * implies, worst first. This is what AI clubs shop against.
 */
export function squadNeeds(club: Club, formationName = DEFAULT_FORMATION): SquadNeed[] {
  const formation = FORMATIONS[formationName] ?? FORMATIONS[DEFAULT_FORMATION]!;
  const target = targetAbility(club.reputation);
  const seen = new Set<Position>();
  const needs: SquadNeed[] = [];

  for (const position of formation) {
    if (seen.has(position)) continue;
    seen.add(position);
    const current = bestAbilityAt(club, position);
    needs.push({ position, current, shortfall: target - current });
  }

  return needs.sort((a, b) => b.shortfall - a.shortfall);
}
