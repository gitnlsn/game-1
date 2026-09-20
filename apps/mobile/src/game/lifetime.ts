import type { Career } from '@eleven-deep/engine';
import type { SaveStorage } from './saves';

/**
 * What the manager has done across *every* career, as opposed to the one in
 * progress.
 *
 * It lives in its own storage key rather than on the `Career`, because the
 * whole point is that it outlives one: abandoning a career deletes the save,
 * and a lifetime total that went with it would only ever read as "this career",
 * which two of the three leaderboards already say.
 */
export const LIFETIME_KEY = 'game1:lifetime:v1';

export interface LifetimeRecord {
  /** Matches the managed club has played, league and cup, across every career. */
  matches: number;
  /** Seasons seen out across every career. The one in progress does not count. */
  seasons: number;
  /**
   * The most seasons a single career has lasted. A career is one club for its
   * whole length -- there is no job market -- so this is the run at one club,
   * and the board ending a career is what ends the run.
   */
  longestRun: number;
  /** What the career in progress has already contributed to the totals above. */
  current: CareerProgress | undefined;
}

export interface CareerProgress {
  /**
   * Which career this is.
   *
   * Minted by the app when a career starts rather than derived from the world:
   * a second career on the same seed *and* the same club is a different career
   * and has to count again, and seed plus club id cannot tell the two apart.
   */
  key: string;
  /** Own matches in `career.season` as of the last sync. */
  matchesThisSeason: number;
  /** Completed seasons as of the last sync. */
  seasons: number;
}

export function emptyLifetime(): LifetimeRecord {
  return { matches: 0, seasons: 0, longestRun: 0, current: undefined };
}

/**
 * Matches the managed club has played in the season in progress.
 *
 * Read off the results list rather than the league table because the table is
 * league only, and a cup run is matches played by any reading a player would
 * recognise.
 */
export function ownMatchesThisSeason(career: Career): number {
  return career.season.results.filter(
    (result) =>
      result.homeClubId === career.managedClubId || result.awayClubId === career.managedClubId,
  ).length;
}

/**
 * Folds whatever the career has done since the last sync into the totals.
 *
 * Called on every mutation, so it has to be idempotent: syncing twice without
 * a match in between must not count a match. It works in deltas against
 * `current` for exactly that reason -- recomputing a career's whole history
 * each time is not possible anyway, since a finished season's cup matches are
 * not kept anywhere.
 */
export function recordProgress(
  record: LifetimeRecord,
  key: string,
  career: Career,
): LifetimeRecord {
  const seasons = career.history.length;
  const matches = ownMatchesThisSeason(career);

  if (record.current?.key !== key) return adopt(record, key, career, seasons, matches);

  const current = record.current;
  /*
   * Within a season the results list only grows, so the difference is the
   * honest number of matches played since the last sync.
   *
   * It *shrinking* means `career.season` has been replaced by a fresh state --
   * the new season has started -- so we rebase on the new list rather than
   * treating it as matches un-played. Note that this is not the same moment as
   * the season count going up: `endSeason` banks the season and leaves the
   * finished `SeasonState` in place for the transfer window, and only
   * `startNextSeason` swaps it. Counting matches off the season boundary
   * instead would count that last season twice.
   */
  const played = Math.max(0, matches - current.matchesThisSeason);
  const seenOut = Math.max(0, seasons - current.seasons);

  return {
    matches: record.matches + played,
    seasons: record.seasons + seenOut,
    longestRun: Math.max(record.longestRun, seasons),
    current: { key, matchesThisSeason: matches, seasons },
  };
}

/**
 * Takes on a career the record has never seen.
 *
 * Usually a brand new one, where there is nothing to take on. The case worth
 * writing for is the other one: a save that predates this record entirely.
 * Banking its finished seasons is the difference between a six-season career
 * reading six and reading zero, and zero would be a lie.
 */
function adopt(
  record: LifetimeRecord,
  key: string,
  career: Career,
  seasons: number,
  matches: number,
): LifetimeRecord {
  return {
    matches: record.matches + leagueMatchesInHistory(career) + matches,
    seasons: record.seasons + seasons,
    longestRun: Math.max(record.longestRun, seasons),
    current: { key, matchesThisSeason: matches, seasons },
  };
}

/**
 * League matches the managed club played in its completed seasons.
 *
 * Only ever used to backfill a career this record has not been counting. Cup
 * matches from those seasons are gone -- a `SeasonSummary` keeps the tables and
 * the tables are league only -- so a backfilled total is a little short. That
 * is a one-off cost the first time a save is adopted, and it is much smaller
 * than the alternative of starting the player at zero.
 */
function leagueMatchesInHistory(career: Career): number {
  let matches = 0;
  for (const summary of career.history) {
    const table =
      summary.tables.find((rows) => rows.some((row) => row.clubId === career.managedClubId)) ??
      summary.table;
    matches += table.find((row) => row.clubId === career.managedClubId)?.played ?? 0;
  }
  return matches;
}

/**
 * Closes the career in progress.
 *
 * The totals need no adjusting: every match and season was banked as it
 * happened, and `longestRun` has been keeping up. All that goes is the delta
 * bookkeeping, so the next career starts counting from its own zero.
 */
export function endCareer(record: LifetimeRecord): LifetimeRecord {
  return { ...record, current: undefined };
}

/** Whether a sync actually moved anything, so a no-op costs no write. */
export function sameLifetime(a: LifetimeRecord, b: LifetimeRecord): boolean {
  return (
    a.matches === b.matches &&
    a.seasons === b.seasons &&
    a.longestRun === b.longestRun &&
    a.current?.key === b.current?.key &&
    a.current?.matchesThisSeason === b.current?.matchesThisSeason &&
    a.current?.seasons === b.current?.seasons
  );
}

/** A fresh career identity. Only has to be unique on this device. */
export function newCareerKey(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export async function loadLifetime(storage: SaveStorage): Promise<LifetimeRecord> {
  try {
    const json = await storage.getItem(LIFETIME_KEY);
    if (!json) return emptyLifetime();
    return { ...emptyLifetime(), ...(JSON.parse(json) as Partial<LifetimeRecord>) };
  } catch {
    /*
     * Starting the totals over is the worst outcome here and it is still only
     * a leaderboard. Refusing to load a career because a stats blob is corrupt
     * would be wildly out of proportion.
     */
    return emptyLifetime();
  }
}

export async function saveLifetime(storage: SaveStorage, record: LifetimeRecord): Promise<void> {
  await storage.setItem(LIFETIME_KEY, JSON.stringify(record));
}
