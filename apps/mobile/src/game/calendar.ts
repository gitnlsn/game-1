import {
  CUP_TUNING,
  cupRoundName,
  findClub,
  firstRoundClubs,
  isMidweek,
  isSeasonComplete,
  transferWindow,
  type Career,
  type CupState,
  type CupTie,
  type Fixture,
  type MatchResult,
} from '@eleven-deep/engine';

/**
 * The season laid out matchday by matchday, from the managed club's point of
 * view.
 *
 * Note what this is not: a calendar of dates. There are none anywhere in the
 * engine -- a `Fixture` carries a matchday number and a `World` carries a season
 * number -- so this counts matchdays, the same call `summary.ts` makes when it
 * says "Season 3" rather than inventing a date.
 */

export type Outcome = 'W' | 'D' | 'L';

/** Goals from the managed club's point of view, whichever end it was at. */
export interface CalendarScore {
  for: number;
  against: number;
}

export interface LeagueSlot {
  kind: 'league';
  /** The division's name. */
  competition: string;
  opponentId: string;
  opponentName: string;
  home: boolean;
  /**
   * Absent until played. The presence of a score -- not `status` -- is what
   * "played" means: a live match is held back by `skipClubId`, which leaves the
   * round open, so a fixture can be `current` and unplayed at the same time.
   */
  score?: CalendarScore;
  outcome?: Outcome;
}

export interface CupTieSlot {
  kind: 'cupTie';
  competition: string;
  /** "Quarter-finals" -- the long form, for the accessibility label. */
  roundName: string;
  /** "QF" -- the short form, for the tag column. */
  roundShort: string;
  opponentId: string;
  opponentName: string;
  home: boolean;
  /** After ninety minutes. */
  score?: CalendarScore;
  /**
   * Goals scored *in* extra time, not an aggregate: `resolveCupTie` plays a
   * separate thirty-minute match and stores it on its own. Kept in the engine's
   * terms; the view adds the two together to show a final score.
   */
  extraTime?: CalendarScore;
  shootout?: CalendarScore;
  /** A knockout cannot end drawn, so never 'D'. */
  outcome?: Exclude<Outcome, 'D'>;
}

/** A reserved cup matchday this club is not playing on. */
export interface CupRoundSlot {
  kind: 'cupRound';
  competition: string;
  roundName: string;
  roundShort: string;
  /**
   * 'undrawn'    still in, the draw has not been made -- which includes today's,
   *              because the engine draws a round only once its matchday is
   *              played
   * 'bye'        still in, sat this round out
   * 'eliminated' already knocked out
   */
  state: 'undrawn' | 'bye' | 'eliminated';
}

/** Nothing on: a league bye, or a reserved matchday the cup never reached. */
export interface FreeSlot {
  kind: 'free';
}

export type CalendarSlot = LeagueSlot | CupTieSlot | CupRoundSlot | FreeSlot;

export type CalendarEntry = {
  /** 1-based matchday -- the engine's `Fixture.round`. */
  matchday: number;
  /** Position relative to `nextRound`. Position only; see `LeagueSlot.score`. */
  status: 'played' | 'current' | 'upcoming';
  /** A reserved cup matchday: no week passes before it, so nobody recovers. */
  midweek: boolean;
} & CalendarSlot;

/**
 * The close-season window. It has no matchday of its own -- it sits entirely
 * after the last one and before matchday 1 of the next season -- which is why
 * it is a band below the list rather than a row in it.
 */
export interface WindowBand {
  open: boolean;
  season: number;
  /** Always `totalRounds`. */
  afterMatchday: number;
}

export interface SeasonCalendar {
  season: number;
  clubName: string;
  totalRounds: number;
  /** One per matchday, 1..totalRounds, in order, no gaps. */
  entries: CalendarEntry[];
  /** The matchday being waited on; undefined once the season is complete. */
  currentMatchday: number | undefined;
  window: WindowBand;
}

export function seasonCalendar(career: Career): SeasonCalendar {
  const me = career.managedClubId;
  const season = career.season;
  const cup = season.cup;

  const fixtures = fixturesByMatchday(career, me);
  const results = resultsByPairing(career, me);
  const ties = cupTiesByRound(cup, me);
  const eliminatedIn = [...ties.values()].find(
    (tie) => tie.winnerClubId !== undefined && tie.winnerClubId !== me,
  )?.round;
  const field = cup ? cupFieldByRound(cup) : { size: [], lastRoundIndex: -1 };

  const total = season.totalRounds;
  const next = season.nextRound;
  const entries: CalendarEntry[] = [];

  for (let matchday = 1; matchday <= total; matchday++) {
    const common = {
      matchday,
      status: matchday < next ? 'played' : matchday === next ? 'current' : 'upcoming',
      midweek: isMidweek(season, matchday),
    } as const;

    const cupIndex = cup ? CUP_TUNING.rounds.indexOf(matchday) : -1;

    if (cup && cupIndex >= 0) {
      entries.push({
        ...common,
        ...cupSlot(career, cup, field, ties, eliminatedIn, cupIndex, matchday < next),
      });
      continue;
    }

    const fixture = fixtures.get(matchday);
    if (!fixture) {
      entries.push({ ...common, kind: 'free' });
      continue;
    }

    entries.push({ ...common, ...leagueSlot(career, fixture, results, me) });
  }

  const window = transferWindow(career);

  return {
    season: career.world.season,
    clubName: findClub(career.world, me)?.name ?? 'Unknown',
    totalRounds: total,
    entries,
    currentMatchday: isSeasonComplete(career) ? undefined : next,
    window: {
      open: window !== undefined,
      season: window?.season ?? career.world.season,
      afterMatchday: total,
    },
  };
}

/**
 * At most one fixture per matchday: a club plays once, and a cup matchday
 * carries no league fixtures -- which is the whole point of `spreadAroundCup`.
 * Byes never appear here at all, because `generateFixtures` drops the phantom
 * club's pairings before anyone sees them.
 */
function fixturesByMatchday(career: Career, me: string): Map<number, Fixture> {
  const byMatchday = new Map<number, Fixture>();
  for (const fixture of career.season.fixtures) {
    if (fixture.homeClubId !== me && fixture.awayClubId !== me) continue;
    byMatchday.set(fixture.round, fixture);
  }
  return byMatchday;
}

/**
 * Results indexed by competition and pairing, because a `MatchResult` carries no
 * matchday and there is nothing else to join on.
 *
 * The competition has to be part of the key. Two clubs from the same division
 * drawn together in the cup produce a result whose ordered pair the league
 * fixture list also contains -- exactly the hazard `MatchResult.competitionId`
 * exists for -- and without it a league matchday would borrow the cup's
 * scoreline and show a score for a match that has not been played.
 *
 * Within one league the pairing is unique: a double round robin reverses the
 * venue for the return, which is a different key.
 */
function resultsByPairing(career: Career, me: string): Map<string, MatchResult> {
  const byPairing = new Map<string, MatchResult>();
  for (const result of career.season.results) {
    if (result.homeClubId !== me && result.awayClubId !== me) continue;
    byPairing.set(pairingKey(result.competitionId, result.homeClubId, result.awayClubId), result);
  }
  return byPairing;
}

/**
 * `competitionId` is optional on the type, though every result the season
 * produces is stamped with one. An unstamped result simply never matches, which
 * leaves a score blank rather than putting a wrong one on the wrong matchday.
 */
function pairingKey(competitionId: string | undefined, home: string, away: string): string {
  return `${competitionId ?? ''}|${home}|${away}`;
}

function leagueSlot(
  career: Career,
  fixture: Fixture,
  results: Map<string, MatchResult>,
  me: string,
): LeagueSlot {
  const home = fixture.homeClubId === me;
  const opponentId = home ? fixture.awayClubId : fixture.homeClubId;
  const result = results.get(
    pairingKey(fixture.competitionId, fixture.homeClubId, fixture.awayClubId),
  );

  const slot: LeagueSlot = {
    kind: 'league',
    competition:
      career.world.leagues.find((league) => league.id === fixture.competitionId)?.name ?? '',
    opponentId,
    opponentName: findClub(career.world, opponentId)?.name ?? 'Unknown',
    home,
  };

  if (result) {
    const score = orient(result.home.goals, result.away.goals, home);
    slot.score = score;
    slot.outcome = score.for > score.against ? 'W' : score.for === score.against ? 'D' : 'L';
  }

  return slot;
}

/**
 * Cup rows come from the ties, not from the results.
 *
 * A `MatchResult` for a cup tie holds the ninety and nothing else -- extra time
 * is a second match and the shootout is not a match at all -- so joining through
 * results would silently drop both. The tie has all three, and a tie's matchday
 * is `CUP_TUNING.rounds[round - 1]`, so it needs no join either.
 */
function cupTiesByRound(cup: CupState | undefined, me: string): Map<number, CupTie> {
  const byRound = new Map<number, CupTie>();
  for (const tie of cup?.ties ?? []) {
    if (tie.homeClubId !== me && tie.awayClubId !== me) continue;
    byRound.set(tie.round, tie);
  }
  return byRound;
}

function cupSlot(
  career: Career,
  cup: CupState,
  field: { size: number[]; lastRoundIndex: number },
  ties: Map<number, CupTie>,
  eliminatedIn: number | undefined,
  cupIndex: number,
  past: boolean,
): CupTieSlot | CupRoundSlot | FreeSlot {
  // A reserved matchday the cup never reaches: a small field needs fewer rounds
  // than the six `CUP_TUNING.rounds` always sets aside.
  if (cupIndex > field.lastRoundIndex) return { kind: 'free' };

  const remaining = field.size[cupIndex] ?? cup.remaining.length;
  const roundName = cupRoundName(remaining);
  const roundShort = shortRoundName(remaining);
  const tie = ties.get(cupIndex + 1);

  if (tie) {
    const home = tie.homeClubId === career.managedClubId;
    const opponentId = home ? tie.awayClubId : tie.homeClubId;

    const slot: CupTieSlot = {
      kind: 'cupTie',
      competition: cup.name,
      roundName,
      roundShort,
      opponentId,
      opponentName: findClub(career.world, opponentId)?.name ?? 'Unknown',
      home,
    };

    if (tie.score) slot.score = orient(tie.score.home, tie.score.away, home);
    if (tie.extraTime) slot.extraTime = orient(tie.extraTime.home, tie.extraTime.away, home);
    if (tie.shootout) slot.shootout = orient(tie.shootout.home, tie.shootout.away, home);
    if (tie.winnerClubId) {
      slot.outcome = tie.winnerClubId === career.managedClubId ? 'W' : 'L';
    }

    return slot;
  }

  const state =
    eliminatedIn !== undefined && cupIndex + 1 > eliminatedIn
      ? 'eliminated'
      : past
        ? // The round was played and we were not in it. With a field that is not
          // a power of two only the smallest clubs play the first round.
          'bye'
        : // Not drawn yet -- including today's, because a round is drawn only
          // when its matchday is played.
          'undrawn';

  return { kind: 'cupRound', competition: cup.name, roundName, roundShort, state };
}

/** Goals as for/against, given which end the managed club was at. */
function orient(home: number, away: number, atHome: boolean): CalendarScore {
  return atHome ? { for: home, against: away } : { for: away, against: home };
}

/**
 * The field entering every cup round, so each reserved matchday can be named.
 *
 * Backwards from now it is exact: each tie removes one club, so the field before
 * a round is the field after it plus that round's ties. Forwards it is a
 * projection, which for a straight knockout is also exact.
 */
function cupFieldByRound(cup: CupState): { size: number[]; lastRoundIndex: number } {
  const size: number[] = [];

  const tiesPerRound = new Map<number, number>();
  for (const tie of cup.ties) {
    tiesPerRound.set(tie.round, (tiesPerRound.get(tie.round) ?? 0) + 1);
  }

  let back = cup.remaining.length;
  size[cup.roundIndex] = back;
  for (let index = cup.roundIndex - 1; index >= 0; index--) {
    back += tiesPerRound.get(index + 1) ?? 0;
    size[index] = back;
  }

  // An integer walk rather than a logarithm: it reuses the engine's own bye rule
  // and has no floating-point edges.
  let forward = cup.remaining.length;
  for (let index = cup.roundIndex; forward > 1; index++) {
    size[index] = forward;
    const entering = firstRoundClubs(forward);
    forward = entering > 0 ? forward - entering / 2 : forward / 2;
  }

  /*
   * The last round the cup actually has, which is the last one more than one
   * club goes into. It cannot be read off `roundIndex`: that keeps advancing
   * once the cup is won -- a three-round cup finishes with `roundIndex` at 6 --
   * so trusting it would hand the winners three more rounds to play.
   */
  let lastRoundIndex = -1;
  for (let index = 0; index < size.length; index++) {
    if ((size[index] ?? 0) > 1) lastRoundIndex = index;
  }

  return { size, lastRoundIndex: Math.min(lastRoundIndex, CUP_TUNING.rounds.length - 1) };
}

/** The tag-column form of `cupRoundName`, and it follows the same rule. */
function shortRoundName(clubsRemaining: number): string {
  if (clubsRemaining <= 1) return 'W';
  if (clubsRemaining === 2) return 'F';
  if (clubsRemaining <= 4) return 'SF';
  if (clubsRemaining <= 8) return 'QF';
  const isPowerOfTwo = (clubsRemaining & (clubsRemaining - 1)) === 0;
  return isPowerOfTwo ? `R${clubsRemaining}` : 'R1';
}
