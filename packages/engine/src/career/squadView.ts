import type { Player, Position, PositionGroup } from '../types.js';
import {
  abilityIn,
  DEFAULT_FORMATION,
  FORMATIONS,
  POSITION_GROUP,
  positionFamiliarity,
  SQUAD_SHAPE,
} from '../world/positions.js';
import { currentAbility } from '../world/players.js';
import { depthAt } from '../transfers/needs.js';
import { EFFECTIVENESS_TUNING } from '../match/ratings.js';
import {
  currentTeamSheet,
  managedClub,
  playersOnLoan,
  scoutReport,
  type Career,
} from './controller.js';

/**
 * Where a player stands in the squad, as opposed to whether he plays this week.
 *
 * - key: in the strongest eleven for the formation you play.
 * - rotation: the next men in, the bench of that eleven.
 * - prospect: young, with clearly more to come on your scouts' reading.
 * - backup: cover that is not in the matchday squad, but the squad needs.
 * - surplus: more of him than the squad needs, and not good enough to play.
 */
export type SquadRole = 'key' | 'rotation' | 'prospect' | 'backup' | 'surplus';

export const SQUAD_VIEW_TUNING = {
  /** Oldest a player can be and still count as a prospect. */
  prospectMaxAge: 21,
  /**
   * How far the bottom of his scouted band must sit above what he is now. The
   * same margin the player screen reads as "clearly more to come".
   */
  prospectMargin: 6,
  /** Share of the season's minutes below which a prospect is "not playing". */
  prospectMinutesShare: 0.25,
  /** Rounds into the season before minutes mean anything. */
  minutesAlertFromRound: 8,
} as const;

export interface SquadMember {
  player: Player;
  role: SquadRole;
  /** In the last year of his contract. Separate from role: a key man can be expiring. */
  expiring: boolean;
  /** Set when he is out on loan, with where. */
  loanedTo?: string;
}

/**
 * The strongest eleven and bench for a formation, ignoring this week's fitness
 * and injuries. A role is about standing in the squad: a first-choice centre half
 * does not stop being one because he is out for a fortnight.
 */
function strongestSquad(squad: readonly Player[], formation: readonly Position[]) {
  const used = new Set<string>();
  // Fill the scarcest positions first, so the only goalkeeper is not spent at
  // centre half by an earlier slot.
  const order = formation
    .map((position, index) => ({ position, index }))
    .sort(
      (a, b) =>
        squad.filter((p) => p.position === a.position).length -
        squad.filter((p) => p.position === b.position).length,
    );

  for (const { position } of order) {
    let best: Player | undefined;
    let bestScore = -Infinity;
    for (const player of squad) {
      if (used.has(player.id)) continue;
      const score = abilityIn(player.attributes, position) * positionFamiliarity(player.position, position);
      if (score > bestScore) {
        bestScore = score;
        best = player;
      }
    }
    if (best) used.add(best.id);
  }

  const starters = new Set(used);
  const bench = new Set(
    squad
      .filter((p) => !starters.has(p.id))
      .sort((a, b) => currentAbility(b) - currentAbility(a))
      .slice(0, EFFECTIVENESS_TUNING.benchSize)
      .map((p) => p.id),
  );
  return { starters, bench };
}

/** The managed squad, each player with where he stands. Loaned-out players included. */
export function squadMembers(career: Career): SquadMember[] {
  const V = SQUAD_VIEW_TUNING;
  const club = managedClub(career);
  const formation = FORMATIONS[currentTeamSheet(career).formation] ?? FORMATIONS[DEFAULT_FORMATION]!;
  const { starters, bench } = strongestSquad(club.squad, formation);

  const roleOf = (player: Player, inSquad: boolean): SquadRole => {
    if (inSquad && starters.has(player.id)) return 'key';
    const ability = currentAbility(player);
    const report = scoutReport(career, player);
    if (player.age <= V.prospectMaxAge && report.low > ability + V.prospectMargin) return 'prospect';
    if (inSquad && bench.has(player.id)) return 'rotation';
    if (inSquad && depthAt(club, player.position) > SQUAD_SHAPE[player.position]) return 'surplus';
    return 'backup';
  };

  const members: SquadMember[] = club.squad.map((player) => ({
    player,
    role: roleOf(player, true),
    expiring: player.contract.yearsRemaining <= 1,
  }));
  for (const { player, otherClub } of playersOnLoan(career)) {
    members.push({
      player,
      role: roleOf(player, false),
      expiring: player.contract.yearsRemaining <= 1,
      loanedTo: otherClub?.name ?? 'another club',
    });
  }
  return members;
}

export interface PositionDepth {
  group: PositionGroup;
  /** Natural players in the group, on loan excluded. */
  have: number;
  /** Slots in the formation, plus the cover a squad of this shape carries. */
  need: number;
  /** Slots in the formation alone. */
  starting: number;
}

/** How many players each part of the pitch has against what the formation asks. */
export function squadDepth(career: Career): PositionDepth[] {
  const club = managedClub(career);
  const formation = FORMATIONS[currentTeamSheet(career).formation] ?? FORMATIONS[DEFAULT_FORMATION]!;
  const groups: PositionGroup[] = ['GK', 'DEF', 'MID', 'FWD'];

  return groups.map((group) => {
    const positions = (Object.keys(SQUAD_SHAPE) as Position[]).filter((p) => POSITION_GROUP[p] === group);
    return {
      group,
      have: club.squad.filter((p) => POSITION_GROUP[p.position] === group).length,
      need: positions.reduce((sum, p) => sum + SQUAD_SHAPE[p], 0),
      starting: formation.filter((p) => POSITION_GROUP[p] === group).length,
    };
  });
}

export type SquadAlertKind = 'expiring_key' | 'prospect_benched' | 'thin_position' | 'surplus';

/**
 * One kind of thing worth acting on, with everyone it applies to. Grouped
 * rather than one line per player: the advice is about the situation, and
 * saying it once per player only buries the names.
 */
export interface SquadAlertGroup {
  kind: SquadAlertKind;
  title: string;
  /** What to do about it, said once for the whole group. */
  advice: string;
  players: Player[];
  /** For thin positions, which ones. */
  positions: Position[];
}

/** The few things about the squad worth acting on now, each with an obvious next step. */
export function squadAlerts(career: Career): SquadAlertGroup[] {
  const V = SQUAD_VIEW_TUNING;
  const club = managedClub(career);
  const members = squadMembers(career);
  const groups: SquadAlertGroup[] = [];
  const add = (group: Omit<SquadAlertGroup, 'positions'> & { positions?: Position[] }) => {
    if (group.players.length > 0 || (group.positions?.length ?? 0) > 0) {
      groups.push({ positions: [], ...group });
    }
  };

  add({
    kind: 'expiring_key',
    title: 'First-choice players in their last year',
    advice: 'Renew them, or sell while they still have value.',
    players: members.filter((m) => m.role === 'key' && m.expiring).map((m) => m.player),
  });

  const roundsPlayed = career.season.played.get(club.id) ?? 0;
  add({
    kind: 'prospect_benched',
    title: 'Prospects not getting games',
    advice: 'Minutes are what develop them. A loan would.',
    players:
      roundsPlayed < V.minutesAlertFromRound
        ? []
        : members
            .filter(
              (m) =>
                m.role === 'prospect' &&
                !m.loanedTo &&
                m.player.status.minutes / (roundsPlayed * 90) < V.prospectMinutesShare,
            )
            .map((m) => m.player),
  });

  const formation = FORMATIONS[currentTeamSheet(career).formation] ?? FORMATIONS[DEFAULT_FORMATION]!;
  const thin = [...new Set(formation)].filter(
    (position) => depthAt(club, position) <= formation.filter((p) => p === position).length,
  );
  add({
    kind: 'thin_position',
    title: 'No cover',
    advice: 'One injury and someone plays out of position.',
    players: [],
    positions: thin,
  });

  const surplus = members.filter((m) => m.role === 'surplus').map((m) => m.player);
  if (surplus.length >= 2) {
    add({
      kind: 'surplus',
      title: 'Surplus to requirements',
      advice: 'Their wages could go elsewhere. Sell, loan or release.',
      players: surplus,
    });
  }

  return groups;
}
