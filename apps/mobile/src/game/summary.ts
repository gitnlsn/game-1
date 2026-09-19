import {
  boardConfidence,
  isSacked,
  isSeasonComplete,
  leagueTable,
  managedClub,
  managedLeague,
  managedPosition,
  nextFixture,
  transferWindow,
  type Career,
} from '@eleven-deep/engine';

/**
 * What the career is waiting on, in the same order of precedence the club
 * screen applies. The two must agree: if the title screen promises a match the
 * club screen will not offer, Continue becomes a lie.
 */
export type NextUp =
  | { kind: 'sacked'; reason: string }
  | { kind: 'window' }
  | { kind: 'seasonOver' }
  | { kind: 'fixture'; round: number; opponent: string; home: boolean; competition: string; isCup: boolean }
  | { kind: 'bye'; round: number };

/**
 * Everything the title screen needs to describe a save you are coming back to.
 *
 * Derived rather than stored, so it cannot drift from the career it describes.
 * Note what is missing: there is no date and no manager name anywhere in the
 * engine -- a `World` carries a season *number* -- so the card says "Season 3"
 * rather than inventing a calendar.
 */
export interface CareerSummary {
  clubName: string;
  city: string;
  leagueName: string;
  season: number;
  seasonsInCharge: number;
  /**
   * Undefined before a ball is kicked. Every club is level then and the table
   * sorts alphabetically, so a position would be meaningless rather than
   * merely provisional -- the same guard the club screen applies.
   */
  position: number | undefined;
  played: number;
  /** Double round-robin, so it follows the size of *this* division. */
  leagueGames: number;
  points: number;
  boardMood: string;
  next: NextUp;
}

export function careerSummary(career: Career): CareerSummary {
  const club = managedClub(career);
  const league = managedLeague(career);
  const row = leagueTable(career).find((r) => r.clubId === club.id);
  const played = row?.played ?? 0;

  return {
    clubName: club.name,
    city: club.city,
    leagueName: league.name,
    season: career.world.season,
    seasonsInCharge: career.board.seasonsInCharge,
    position: played > 0 ? managedPosition(career) : undefined,
    played,
    leagueGames: (league.clubs.length - 1) * 2,
    points: row?.points ?? 0,
    boardMood: boardConfidence(career).mood,
    next: nextUp(career),
  };
}

function nextUp(career: Career): NextUp {
  if (isSacked(career)) {
    return { kind: 'sacked', reason: career.board.sackReason ?? 'The board has decided to make a change.' };
  }
  // A dismissal outranks an open window: you are not signing anyone.
  if (transferWindow(career)) return { kind: 'window' };
  if (isSeasonComplete(career)) return { kind: 'seasonOver' };

  const upcoming = nextFixture(career);
  if (!upcoming) return { kind: 'bye', round: career.season.nextRound };

  return {
    kind: 'fixture',
    round: career.season.nextRound,
    opponent: upcoming.opponent.name,
    home: upcoming.home,
    competition: upcoming.competition,
    isCup: upcoming.isCup,
  };
}
