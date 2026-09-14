import type { Club, Player, Position } from '../types.js';
import { abilityIn, DEFAULT_FORMATION, FORMATIONS, positionFamiliarity } from '../world/positions.js';

export interface LineupSlot {
  position: Position;
  player: Player;
  /** Ability in the slot actually being played, after the familiarity penalty. */
  effectiveAbility: number;
}

export interface Lineup {
  clubId: string;
  formation: string;
  slots: LineupSlot[];
  goalkeeper: LineupSlot;
}

export interface TeamRating {
  attack: number;
  midfield: number;
  defence: number;
  goalkeeping: number;
}

/**
 * How much a slot contributes to each phase of play. This is what makes shape
 * matter: full backs feed the attack a little, a DM props up the defence.
 */
const PHASE_CONTRIBUTION: Record<Position, { attack: number; midfield: number; defence: number }> = {
  GK: { attack: 0, midfield: 0, defence: 0 },
  CB: { attack: 0, midfield: 0, defence: 1 },
  LB: { attack: 0.1, midfield: 0.2, defence: 0.7 },
  RB: { attack: 0.1, midfield: 0.2, defence: 0.7 },
  DM: { attack: 0, midfield: 0.5, defence: 0.5 },
  CM: { attack: 0.1, midfield: 0.7, defence: 0.2 },
  AM: { attack: 0.6, midfield: 0.4, defence: 0 },
  LW: { attack: 0.85, midfield: 0.15, defence: 0 },
  RW: { attack: 0.85, midfield: 0.15, defence: 0 },
  ST: { attack: 1, midfield: 0, defence: 0 },
};

/**
 * Greedy best-available selection: fill each slot with the unused squad player
 * whose ability in that slot (after the out-of-position penalty) is highest.
 * Slots are filled GK-first because keepers are the least substitutable.
 */
export function selectLineup(club: Club, formationName: string = DEFAULT_FORMATION): Lineup {
  const formation = FORMATIONS[formationName];
  if (!formation) throw new Error(`Unknown formation: ${formationName}`);

  const used = new Set<string>();
  const slots: LineupSlot[] = [];

  const order = [...formation].sort((a, b) => (a === 'GK' ? -1 : b === 'GK' ? 1 : 0));

  for (const position of order) {
    let best: LineupSlot | undefined;
    for (const player of club.squad) {
      if (used.has(player.id)) continue;
      const effectiveAbility =
        abilityIn(player.attributes, position) * positionFamiliarity(player.position, position);
      if (!best || effectiveAbility > best.effectiveAbility) {
        best = { position, player, effectiveAbility };
      }
    }
    if (!best) throw new Error(`selectLineup: squad too small for ${club.name}`);
    used.add(best.player.id);
    slots.push(best);
  }

  const goalkeeper = slots.find((s) => s.position === 'GK');
  if (!goalkeeper) throw new Error(`selectLineup: no goalkeeper slot in ${formationName}`);

  return { clubId: club.id, formation: formationName, slots, goalkeeper };
}

export function computeTeamRating(lineup: Lineup): TeamRating {
  let attackTotal = 0, attackWeight = 0;
  let midTotal = 0, midWeight = 0;
  let defTotal = 0, defWeight = 0;

  for (const slot of lineup.slots) {
    const contribution = PHASE_CONTRIBUTION[slot.position];
    attackTotal += slot.effectiveAbility * contribution.attack;
    attackWeight += contribution.attack;
    midTotal += slot.effectiveAbility * contribution.midfield;
    midWeight += contribution.midfield;
    defTotal += slot.effectiveAbility * contribution.defence;
    defWeight += contribution.defence;
  }

  return {
    attack: attackWeight > 0 ? attackTotal / attackWeight : 1,
    midfield: midWeight > 0 ? midTotal / midWeight : 1,
    defence: defWeight > 0 ? defTotal / defWeight : 1,
    goalkeeping: lineup.goalkeeper.effectiveAbility,
  };
}

/** Overall strength of a club, for display and for AI decisions later. */
export function clubStrength(club: Club): number {
  const rating = computeTeamRating(selectLineup(club));
  return (rating.attack + rating.midfield + rating.defence + rating.goalkeeping * 0.6) / 3.6;
}
