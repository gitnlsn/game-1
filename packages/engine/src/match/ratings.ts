import type { Club, Player, Position, TeamSheet, TeamSheetIssue } from '../types.js';
import { abilityIn, DEFAULT_FORMATION, FORMATIONS, positionFamiliarity } from '../world/positions.js';
import { isAvailable } from '../world/status.js';

export const EFFECTIVENESS_TUNING = {
  /** Effectiveness at zero condition; full condition is 1.0. */
  conditionFloor: 0.7,
  /** Each point of form is worth this much effectiveness, either way. */
  formWeight: 0.01,
  /** Morale swings effectiveness between these bounds. */
  moraleFloor: 0.95,
  moraleRange: 0.1,
  /**
   * Below this condition a manager starts resting players rather than picking
   * them. This is a selection rule, not a performance one: it is why squads get
   * rotated instead of the same eleven playing every week until they drop.
   */
  restThreshold: 75,
  /** Bench size. */
  benchSize: 9,
} as const;

/**
 * How much of their ability a player actually brings today. A tired, out-of-form
 * player on poor morale is measurably worse than their attributes suggest, and
 * because selection uses this number, rotation falls out of it automatically
 * rather than needing a separate rotation rule.
 */
export function effectiveness(player: Player): number {
  const E = EFFECTIVENESS_TUNING;
  const { condition, form, morale } = player.status;
  const conditionFactor = E.conditionFloor + (1 - E.conditionFloor) * (condition / 100);
  const formFactor = 1 + form * E.formWeight;
  const moraleFactor = E.moraleFloor + (morale / 100) * E.moraleRange;
  return conditionFactor * formFactor * moraleFactor;
}

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
  /** Available players not in the XI, best first. */
  bench: Player[];
}

export interface SelectLineupOptions {
  /**
   * Leave out injured and suspended players. On by default; turning it off is
   * only useful for inspecting a squad's theoretical best eleven.
   */
  respectAvailability?: boolean;
  /** A manager's instructions. Unfilled slots fall through to the auto-pick. */
  teamSheet?: TeamSheet;
  /** Collects anything the engine had to correct. */
  issues?: TeamSheetIssue[];
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
export function selectLineup(
  club: Club,
  formationName: string = DEFAULT_FORMATION,
  options: SelectLineupOptions = {},
): Lineup {
  const sheet = options.teamSheet;
  const issues = options.issues;

  let resolvedFormation = sheet?.formation ?? formationName;
  if (!FORMATIONS[resolvedFormation]) {
    if (sheet) {
      issues?.push({ kind: 'unknown_formation' });
      resolvedFormation = FORMATIONS[formationName] ? formationName : DEFAULT_FORMATION;
    } else {
      throw new Error(`Unknown formation: ${formationName}`);
    }
  }
  const formation = FORMATIONS[resolvedFormation]!;

  const respectAvailability = options.respectAvailability ?? true;
  let candidates = respectAvailability ? club.squad.filter(isAvailable) : club.squad;

  // A club with too many players unavailable has to field whoever is left rather
  // than fail to put out a team.
  if (candidates.length < formation.length) candidates = club.squad;

  const used = new Set<string>();
  const slots: (LineupSlot | undefined)[] = new Array(formation.length).fill(undefined);

  if (sheet && sheet.starters.length !== formation.length) {
    issues?.push({ kind: 'wrong_length' });
  }

  // Pass one: honour whatever the manager pinned, reporting anything that can no
  // longer be picked.
  if (sheet) {
    const squadById = new Map(club.squad.map((player) => [player.id, player]));
    formation.forEach((position, index) => {
      const wanted = sheet.starters[index];
      if (wanted === undefined) return;

      const player = squadById.get(wanted);
      if (!player) {
        issues?.push({ kind: 'not_in_squad', slotIndex: index, playerId: wanted });
        return;
      }
      if (used.has(player.id)) {
        issues?.push({ kind: 'duplicate', slotIndex: index, playerId: wanted });
        return;
      }
      if (respectAvailability && !isAvailable(player)) {
        issues?.push({
          kind: player.status.injuryMatches > 0 ? 'injured' : 'suspended',
          slotIndex: index,
          playerId: wanted,
        });
        return;
      }

      used.add(player.id);
      slots[index] = toSlot(player, position);
    });
  }

  // Pass two: the existing greedy pick fills whatever is left, seeded with the
  // players already spoken for. Keepers first, since they are the least
  // substitutable.
  const remaining = formation
    .map((position, index) => ({ position, index }))
    .filter(({ index }) => slots[index] === undefined)
    .sort((a, b) => (a.position === 'GK' ? -1 : b.position === 'GK' ? 1 : 0));

  for (const { position, index } of remaining) {
    let best: LineupSlot | undefined;
    let bestScore = -Infinity;
    for (const player of candidates) {
      if (used.has(player.id)) continue;
      const score = selectionScore(player, position);
      if (score > bestScore) {
        bestScore = score;
        best = toSlot(player, position);
      }
    }
    if (!best) throw new Error(`selectLineup: squad too small for ${club.name}`);
    used.add(best.player.id);
    slots[index] = best;

    // Report who actually took a slot the manager had asked someone else to fill.
    const wanted = sheet?.starters[index];
    if (wanted !== undefined && issues) {
      const issue = issues.find((i) => i.slotIndex === index);
      if (issue) issue.replacementId = best.player.id;
    }
  }

  const filled = slots as LineupSlot[];
  const goalkeeper = filled.find((slot) => slot.position === 'GK');
  if (!goalkeeper) throw new Error(`selectLineup: no goalkeeper slot in ${resolvedFormation}`);

  // Preferred substitutes first, then the best of the rest.
  const preferred: Player[] = [];
  if (sheet) {
    const squadById = new Map(club.squad.map((player) => [player.id, player]));
    for (const id of sheet.bench) {
      const player = squadById.get(id);
      if (!player || used.has(id)) continue;
      if (respectAvailability && !isAvailable(player)) continue;
      preferred.push(player);
      used.add(id);
    }
  }

  const bench = [
    ...preferred,
    ...candidates
      .filter((player) => !used.has(player.id))
      .sort((a, b) => rawAbility(b) - rawAbility(a)),
  ].slice(0, EFFECTIVENESS_TUNING.benchSize);

  return { clubId: club.id, formation: resolvedFormation, slots: filled, goalkeeper, bench };
}

/**
 * Reads a team sheet into an eleven, reporting anything it had to correct.
 *
 * The engine never writes back to the sheet. A player who is injured this week
 * is silently replaced and returns automatically when fit, so there is no "your
 * team sheet was cleared" moment.
 */
export function resolveTeamSheet(
  club: Club,
  sheet: TeamSheet | undefined,
  fallbackFormation: string = DEFAULT_FORMATION,
): { lineup: Lineup; issues: TeamSheetIssue[] } {
  const issues: TeamSheetIssue[] = [];
  const lineup = selectLineup(club, fallbackFormation, {
    ...(sheet ? { teamSheet: sheet } : {}),
    issues,
  });
  return { lineup, issues };
}

/** The same checks as resolveTeamSheet, without building anything. For UI warnings. */
export function validateTeamSheet(
  club: Club,
  sheet: TeamSheet,
  fallbackFormation: string = DEFAULT_FORMATION,
): TeamSheetIssue[] {
  return resolveTeamSheet(club, sheet, fallbackFormation).issues;
}

/** Rates a player in a slot, after position familiarity and today's condition. */
export function toSlot(player: Player, position: Position): LineupSlot {
  return {
    position,
    player,
    effectiveAbility:
      abilityIn(player.attributes, position) *
      positionFamiliarity(player.position, position) *
      effectiveness(player),
  };
}

/**
 * How attractive a player is to pick today. Distinct from how well they would
 * play: a manager weighs a tired player down further than their drop in
 * effectiveness alone, because resting them now protects later matches.
 */
function selectionScore(player: Player, position: Position): number {
  const E = EFFECTIVENESS_TUNING;
  const { condition } = player.status;
  const restFactor = condition < E.restThreshold ? Math.pow(condition / E.restThreshold, 2) : 1;
  return toSlot(player, position).effectiveAbility * restFactor;
}

function rawAbility(player: Player): number {
  return abilityIn(player.attributes, player.position) * effectiveness(player);
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
  const rating = computeTeamRating(selectLineup(club, DEFAULT_FORMATION, { respectAvailability: false }));
  return (rating.attack + rating.midfield + rating.defence + rating.goalkeeping * 0.6) / 3.6;
}
