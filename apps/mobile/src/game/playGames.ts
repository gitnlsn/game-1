import { Platform } from 'react-native';
import { gameServices } from '@tubinex/expo-game-services';
import config from '../../playgames.json';
import type { LifetimeRecord } from './lifetime';

/**
 * Google Play Games leaderboards.
 *
 * Android only, and optional even there: `playgames.json` ships empty, the
 * config plugin is left out of the build when it is (see `app.config.js`), and
 * every function here turns into a no-op. That is not just defensiveness about
 * unconfigured checkouts -- this app is developed against react-native-web,
 * where there is no native module at all, and a leaderboard is not worth
 * breaking that over.
 *
 * Nothing here throws. A leaderboard is decoration on a football manager: if
 * Play Services is unavailable, the account is signed out, the device is
 * offline or Google simply says no, the game carries on and nobody is told.
 *
 * Nobody *playing*, that is. Every one of those swallowed failures is logged
 * under `[PlayGames]` in development, because silence is the right behaviour
 * for a player and the worst possible behaviour for whoever has to work out
 * why a board is empty. `adb logcat -s ReactNativeJS` shows them.
 */

const TAG = '[PlayGames]';

function note(...parts: unknown[]): void {
  if (__DEV__) console.log(TAG, ...parts);
}

/**
 * Logs a failure we are about to swallow.
 *
 * Pulls `code` out when the module supplies one -- `not-authenticated` and
 * `configuration-missing` need completely different fixes, and the message
 * alone does not always say which you have.
 */
function noteFailure(what: string, error: unknown): void {
  if (!__DEV__) return;
  const detail = error as { code?: string; message?: string } | undefined;
  console.warn(TAG, what, detail?.code ? `[${detail.code}]` : '', detail?.message ?? error);
}

export type Board = keyof typeof config.leaderboards;

/**
 * Which leaderboard each total goes to, in the order they are shown. The ids
 * come from the Play Console; an empty one means that board has not been
 * created yet and is skipped everywhere.
 */
export const BOARDS: readonly Board[] = ['matches', 'seasons', 'longestRun'];

function boardId(board: Board): string {
  return config.leaderboards[board];
}

export function boardConfigured(board: Board): boolean {
  return boardId(board) !== '';
}

/** Where the player stands on each board, when Google will say. */
export type Ranks = Partial<Record<Board, number>>;

/**
 * How an attempt to open the boards ended.
 *
 * Silence is right for a submission nobody asked for and wrong for a button
 * somebody pressed: a tap that does nothing at all reads as a broken app. So
 * the interactive path reports back, and the screens say something.
 *
 * `declined` is deliberately separate from `failed`. Backing out of the
 * sign-in sheet is a decision, and being told your decision did not work would
 * be absurd.
 */
export type LeaderboardOutcome = 'opened' | 'declined' | 'unavailable' | 'failed';

/** What to tell the player, or nothing when there is nothing worth saying. */
export function leaderboardProblem(outcome: LeaderboardOutcome): string | undefined {
  switch (outcome) {
    case 'opened':
    case 'declined':
      return undefined;
    case 'unavailable':
      return 'Play Games is not available on this device.';
    case 'failed':
      return 'Could not sign in to Play Games.';
  }
}

/**
 * Whether there is any point calling the rest of this.
 *
 * Synchronous on purpose: the title screen decides whether to render the
 * leaderboards button during a render, and an await there would flash a button
 * in and out on every launch.
 */
export function playGamesAvailable(): boolean {
  return Platform.OS === 'android' && gameServices.isAvailable && /^\d+$/.test(config.appId);
}

/*
 * Said once, at startup, rather than on every call. "Why is the button not
 * there" has exactly three answers and this prints whichever one applies --
 * including on web, where the answer is "it never will be, that is fine".
 */
if (__DEV__ && !playGamesAvailable()) {
  note(
    'unavailable:',
    Platform.OS !== 'android'
      ? `platform is ${Platform.OS}, Play Games is Android only`
      : !gameServices.isAvailable
        ? 'native module not linked -- this is Expo Go, or the build predates the module'
        : 'no numeric appId in playgames.json',
  );
}

/**
 * Signs in if the player is not already.
 *
 * Play Games v2 signs a returning player in by itself, so the usual answer here
 * is "already authenticated" and no UI appears. It is worth asking anyway on
 * launch: the first ever run is the one that needs the prompt, and a player who
 * declined once should not be nagged -- Play Games itself remembers that, which
 * is why this asks rather than deciding.
 */
export async function signIn(): Promise<LeaderboardOutcome> {
  /*
   * Not available is not the same as broken, and a device with no Google Play
   * services -- a Huawei, a Fire tablet, a de-Googled ROM -- can never sign in
   * however many times it is asked.
   */
  if (!playGamesAvailable()) return 'unavailable';

  try {
    const state = await gameServices.authentication.getState();
    if (state.status === 'authenticated') return 'opened';
    if (state.status === 'unavailable') {
      note('sign-in unavailable:', state.reason);
      return 'unavailable';
    }

    note('signing in, current status:', state.status);
    const signedIn = await gameServices.authentication.signIn();
    if (signedIn.status !== 'authenticated') {
      /*
       * The common cause is a signing certificate Play Games does not
       * recognise, and it reports that to logcat rather than to us -- filter
       * on PlayGamesServices for the fingerprint it actually saw.
       */
      note('sign-in did not complete, status:', signedIn.status);
      return 'failed';
    }
    note('signed in as', signedIn.player.displayName);
    return 'opened';
  } catch (error) {
    noteFailure('sign-in failed', error);
    // Backing out of Google's sheet arrives here as a cancellation.
    const code = (error as { code?: string } | undefined)?.code;
    return code === 'cancelled' ? 'declined' : 'failed';
  }
}

/**
 * Whether the player is signed in, *without* asking them to.
 *
 * The distinction matters: reading ranks to fill a screen must never put a
 * sign-in sheet in front of someone who only opened the options tab. Asking is
 * `signIn`, and it belongs to actions the player took deliberately.
 */
async function authenticated(): Promise<boolean> {
  if (!playGamesAvailable()) return false;

  try {
    return (await gameServices.authentication.getState()).status === 'authenticated';
  } catch {
    return false;
  }
}

/**
 * The player's rank on each board.
 *
 * Only the rank. The scores themselves come from our own store, which is why a
 * board still shows its number offline, signed out, and on the very first frame
 * -- Google is asked for the one thing only Google knows.
 *
 * A board that cannot be read is simply left out of the result rather than
 * reported as an error: not being ranked yet and not being able to ask look the
 * same to a player, and both mean "no rank to show".
 */
export async function loadRanks(): Promise<Ranks> {
  if (!(await authenticated())) {
    note('not signed in, so no ranks to show');
    return {};
  }

  const found = await Promise.all(
    BOARDS.map(async (board): Promise<readonly [Board, number | undefined]> => {
      if (!boardConfigured(board)) return [board, undefined];
      try {
        const result = await gameServices.leaderboards.loadCurrentPlayerScore({
          leaderboardId: boardId(board),
          collection: 'public',
          timeScope: 'allTime',
        });
        const rank = result.scores[0]?.rank;
        return [board, typeof rank === 'number' && rank > 0 ? rank : undefined];
      } catch (error) {
        noteFailure(`could not read rank for ${board}`, error);
        return [board, undefined];
      }
    }),
  );

  const ranks: Ranks = {};
  for (const [board, rank] of found) if (rank !== undefined) ranks[board] = rank;
  return ranks;
}

/**
 * The last score each board accepted, so an unchanged one is not sent again.
 *
 * Matches move every round; seasons and the longest run move once a year. With
 * no guard, seeing out a season would post the same two numbers thirty-eight
 * times. Module state rather than storage on purpose -- it only has to be right
 * for the life of the process, and being wrong costs one redundant submission.
 */
const lastSubmitted = new Map<Board, number>();

/**
 * The totals as of the last sync, kept so that signing in later can post them
 * immediately rather than leaving the boards blank until the next match.
 */
let latest: LifetimeRecord | undefined;

/**
 * Hands the lifetime totals over to be posted.
 *
 * Fire and forget, the same bargain the career save makes: the game never waits
 * on Google. Play Services queues submissions it cannot deliver and sends them
 * when the device is next online, so a round played on a train still counts.
 */
export function submitLifetime(record: LifetimeRecord): void {
  latest = record;
  void flushScores();
}

/**
 * Posts whatever has changed, **if the player is already signed in**.
 *
 * `authenticated` rather than `signIn`, and the distinction is the whole
 * function. This runs after every round. Asking it to sign in means a player
 * who is not signed in -- who declined, or whose sign-in is failing for any
 * reason at all -- gets Google's account sheet in their face at the start of
 * every single match. That is intolerable, and it is a leaderboard.
 *
 * Skipping costs nothing. The totals are ours and are already saved; they are
 * kept in `latest` and posted the moment there is a session, which is what
 * `showLeaderboards` calls this for. Signing in through the button therefore
 * puts your existing record straight onto the boards.
 *
 * Zeroes are skipped. Submitting one would put a player who has done nothing on
 * the board on nought matches, which is worse than not being on it.
 */
async function flushScores(): Promise<void> {
  const record = latest;
  if (!record || !playGamesAvailable()) return;

  const pending = BOARDS.filter(
    (board) => boardId(board) && record[board] > 0 && lastSubmitted.get(board) !== record[board],
  );
  if (pending.length === 0) return;

  try {
    if (!(await authenticated())) return;

    await Promise.all(
      pending.map(async (board) => {
        const score = record[board];
        try {
          await gameServices.leaderboards.submitScore(boardId(board), score);
          lastSubmitted.set(board, score);
          note('submitted', board, '=', score);
        } catch (error) {
          noteFailure(`could not submit ${board} = ${score}`, error);
          /*
           * Left out of `lastSubmitted`, so the next round retries it. One
           * board failing is also no reason to drop the other two.
           */
        }
      }),
    );
  } catch {
    // Already the quiet path.
  }
}

/**
 * Opens Google's own leaderboard screen.
 *
 * Google's rather than ours: it already does the tabbing between boards, the
 * daily/weekly/all-time spans, the friends filter and the avatars, and none of
 * that is reachable any other way. Building a worse copy of it over
 * `loadScores` would be work spent going backwards.
 */
export async function showLeaderboards(board?: Board): Promise<LeaderboardOutcome> {
  if (!playGamesAvailable()) return 'unavailable';

  try {
    const outcome = await signIn();
    if (outcome !== 'opened') return outcome;

    /*
     * Everything banked while signed out goes up now. Without this a player who
     * signs in here would see their own boards empty until they happened to
     * play another match.
     */
    void flushScores();

    const id = board ? boardId(board) : '';
    await gameServices.leaderboards.showUI(id ? { leaderboardId: id } : undefined);
    return 'opened';
  } catch (error) {
    noteFailure('could not open the leaderboard UI', error);
    return 'failed';
  }
}
