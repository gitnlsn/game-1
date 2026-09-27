import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  advanceRound,
  beginLiveMatch,
  endLiveMatch,
  endSeason,
  isSacked,
  isSeasonComplete,
  pendingSponsorOffers,
  startCareer,
  startNextSeason,
  transferWindow,
  type Career,
  type LiveMatch,
  type MatchResult,
  type SeasonSummary,
} from '@eleven-deep/engine';
import {
  clearCareer,
  DEFAULT_SETTINGS,
  loadCareer,
  loadSettings,
  saveCareer,
  saveSettings,
  type SaveProblem,
  type Settings,
} from './saves';
import {
  emptyLifetime,
  endCareer as closeLifetimeCareer,
  loadLifetime,
  newCareerKey,
  recordProgress,
  sameLifetime,
  saveLifetime,
  type LifetimeRecord,
} from './lifetime';
import { submitLifetime } from './playGames';

export type { SaveProblem, Settings, LifetimeRecord };

export interface RoundOutcome {
  /** The managed club's match, if they played this round. */
  ownMatch: MatchResult | undefined;
}

interface GameContextValue {
  career: Career | undefined;
  /** Set when a save existed but could not be loaded. */
  saveProblem: SaveProblem | undefined;
  dismissSaveProblem: () => void;
  /** Bumped on every mutation, since the engine mutates the world in place. */
  version: number;
  loading: boolean;
  busy: boolean;
  settings: Settings;
  /**
   * True once the manager has come through the title screen into a live
   * career. It decides which screen set is mounted.
   */
  started: boolean;
  /** Enter the saved career from the title screen. */
  continueCareer: () => void;
  /** Leave a career for the title screen without deleting anything. */
  returnToTitle: () => void;
  newCareer: (seed: string, managedClubId: string) => void;
  playRound: () => Promise<RoundOutcome | undefined>;
  finishSeason: () => Promise<SeasonSummary | undefined>;
  /** Closes the transfer window and starts the new season. */
  beginNextSeason: () => Promise<void>;
  /** True while the close-season window is open and waiting on you. */
  windowOpen: boolean;
  /** Sponsor offers waiting for an answer, for the Money tab to flag. */
  sponsorOffersWaiting: number;
  /** True once the board has dismissed you. The career is over. */
  sacked: boolean;
  /**
   * The match being watched, if any.
   *
   * Held here rather than on the screen because starting one plays the rest of
   * the round: navigating away from a half-played match would leave the season
   * with a round it can neither finish nor replay.
   */
  live: LiveMatch | undefined;
  startLive: () => Promise<LiveMatch | undefined>;
  /** Blows the whistle, books the result and closes the round. */
  endLive: () => MatchResult | undefined;
  /**
   * Re-render and save after a screen has mutated the world directly -- the
   * transfer screen calls engine functions itself rather than going through an
   * action here, because every one of them is a one-liner.
   */
  refresh: () => void;
  abandonCareer: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  /**
   * What the manager has done across every career, not just this one. Kept
   * here because it has to be updated on the same beats the save is, and it
   * is what the Play Games leaderboards are posted from.
   */
  lifetime: LifetimeRecord;
}

const GameContext = createContext<GameContextValue | undefined>(undefined);

/**
 * Lets React paint before a long synchronous block runs.
 *
 * Raced against a timer on purpose: a backgrounded tab suspends animation frames
 * entirely, and waiting on one alone means the promise never settles and the
 * game hangs rather than merely stuttering.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 50);
  });
}

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [career, setCareer] = useState<Career | undefined>();
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saveProblem, setSaveProblem] = useState<SaveProblem | undefined>();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [live, setLive] = useState<LiveMatch | undefined>();
  const [resumed, setResumed] = useState(false);
  const [lifetime, setLifetime] = useState<LifetimeRecord>(emptyLifetime);

  /*
   * The totals are also held in a ref. The effect that folds a career's
   * progress into them has to read the value it wrote on the previous render,
   * and depending on the state would make every sync re-run the effect that
   * caused it.
   */
  const lifetimeRef = useRef<LifetimeRecord>(lifetime);
  /*
   * Which career the totals are currently counting. Minted here rather than
   * taken from the world: two careers can share a seed and a club, and the
   * second one still has to count.
   */
  const careerKey = useRef<string | undefined>(undefined);

  /*
   * Derived, not stored: the invariant "started implies there is a career" is
   * enforced here once rather than at every call site that clears one. It is
   * also why `abandonCareer` needs no line of its own -- dropping the career
   * drops you back to the title by arithmetic.
   */
  const started = resumed && career !== undefined;

  // Restore a save on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loadedSettings = await loadSettings(AsyncStorage);
        if (!cancelled) setSettings(loadedSettings);

        /*
         * Ahead of the career, so the sync effect below never runs against an
         * empty record -- banking a career's progress onto zeroes and then
         * having the load overwrite it would lose exactly one session's worth
         * of matches every launch.
         */
        const loadedLifetime = await loadLifetime(AsyncStorage);
        if (!cancelled) {
          lifetimeRef.current = loadedLifetime;
          careerKey.current = loadedLifetime.current?.key;
          setLifetime(loadedLifetime);
        }

        const result = await loadCareer(AsyncStorage);
        if (cancelled) return;
        if (result.kind === 'career') setCareer(result.career);
        else if (result.kind === 'problem') setSaveProblem(result.problem);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((next: Career) => {
    // Fire and forget: the game never blocks on the save completing.
    saveCareer(AsyncStorage, next).catch((error) => console.warn('Could not save', error));
  }, []);

  /*
   * Folds whatever has happened into the lifetime totals and posts them.
   *
   * Driven off `version` rather than called from each action, so there is one
   * place that can forget to do it rather than eight. `recordProgress` works in
   * deltas and is idempotent, which is what makes running it on every render
   * pass safe -- and `loading` gates it so it cannot run before the stored
   * totals have arrived.
   */
  useEffect(() => {
    if (loading || !career) return;

    careerKey.current ??= newCareerKey();
    const next = recordProgress(lifetimeRef.current, careerKey.current, career);
    if (sameLifetime(next, lifetimeRef.current)) return;

    lifetimeRef.current = next;
    setLifetime(next);
    saveLifetime(AsyncStorage, next).catch(() => {});
    submitLifetime(next);
  }, [career, version, loading]);

  const continueCareer = useCallback(() => setResumed(true), []);

  /*
   * Costs nothing and flushes nothing: saving is save-on-action, so the career
   * on disk is already current. The one exception is a match being watched --
   * `beginLiveMatch` plays the rest of the round in memory without saving, so
   * walking out mid-match would leave the season a round ahead of its save.
   * Unreachable today, since the live screen has no back button and Settings
   * is only on the Club tab, but the failure it prevents is a corrupted round.
   */
  const returnToTitle = useCallback(() => {
    if (live) return;
    setResumed(false);
  }, [live]);

  const newCareer = useCallback(
    (seed: string, managedClubId: string) => {
      const next = startCareer({ seed, managedClubId });
      // A new career counts from its own zero, whatever the last one did.
      careerKey.current = newCareerKey();
      setCareer(next);
      // Picking a club is the same decision as pressing Continue.
      setResumed(true);
      setVersion((v) => v + 1);
      persist(next);
    },
    [persist],
  );

  const playRound = useCallback(async (): Promise<RoundOutcome | undefined> => {
    if (!career || isSeasonComplete(career)) return undefined;

    setBusy(true);
    // Yield a frame so the spinner actually paints. Both setBusy calls used to
    // sit in one synchronous callback, so React batched them away and the UI
    // simply froze while ten matches simulated.
    await nextFrame();
    try {
      const results = advanceRound(career);
      const ownMatch = results.find(
        (r) => r.homeClubId === career.managedClubId || r.awayClubId === career.managedClubId,
      );
      setVersion((v) => v + 1);
      persist(career);
      return { ownMatch };
    } finally {
      setBusy(false);
    }
  }, [career, persist]);

  const finishSeason = useCallback(async (): Promise<SeasonSummary | undefined> => {
    if (!career || !isSeasonComplete(career)) return undefined;

    setBusy(true);
    await nextFrame();
    try {
      const summary = endSeason(career);
      setVersion((v) => v + 1);
      persist(career);
      return summary;
    } finally {
      setBusy(false);
    }
  }, [career, persist]);

  const beginNextSeason = useCallback(async (): Promise<void> => {
    if (!career || !transferWindow(career)) return;

    setBusy(true);
    await nextFrame();
    try {
      startNextSeason(career);
      setVersion((v) => v + 1);
      persist(career);
    } finally {
      setBusy(false);
    }
  }, [career, persist]);

  const startLive = useCallback(async (): Promise<LiveMatch | undefined> => {
    if (!career || isSeasonComplete(career) || live) return undefined;

    setBusy(true);
    await nextFrame();
    try {
      const started = beginLiveMatch(career);
      if (started) {
        setLive(started);
        setVersion((v) => v + 1);
      }
      return started;
    } finally {
      setBusy(false);
    }
  }, [career, live]);

  const endLive = useCallback((): MatchResult | undefined => {
    if (!career || !live) return undefined;

    const result = endLiveMatch(live, career);
    setLive(undefined);
    setVersion((v) => v + 1);
    persist(career);
    return result;
  }, [career, live, persist]);

  /*
   * No `setResumed(false)` here on purpose: `started` is derived from whether
   * a career exists, so clearing one lands you back on the title screen by
   * itself. A second flag here would look load-bearing and would not be.
   */
  const abandonCareer = useCallback(() => {
    setCareer(undefined);
    setLive(undefined);
    setVersion((v) => v + 1);
    clearCareer(AsyncStorage).catch(() => {});

    /*
     * The totals survive the save being deleted -- that is the whole point of
     * them living in their own key. Only the delta bookkeeping is dropped, and
     * with it the run at this club: getting sacked is what ends a streak.
     */
    const ended = closeLifetimeCareer(lifetimeRef.current);
    lifetimeRef.current = ended;
    careerKey.current = undefined;
    setLifetime(ended);
    saveLifetime(AsyncStorage, ended).catch(() => {});
  }, []);

  const refresh = useCallback(() => {
    if (!career) return;
    setVersion((v) => v + 1);
    persist(career);
  }, [career, persist]);

  const dismissSaveProblem = useCallback(() => setSaveProblem(undefined), []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(AsyncStorage, next).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo<GameContextValue>(
    () => ({
      career, version, loading, busy, saveProblem, settings, live, startLive, endLive,
      windowOpen: !!career && !!transferWindow(career),
      sponsorOffersWaiting: career ? pendingSponsorOffers(career).length : 0,
      sacked: !!career && isSacked(career),
      started, continueCareer, returnToTitle,
      newCareer, playRound, finishSeason, beginNextSeason, abandonCareer,
      dismissSaveProblem, updateSettings, refresh, lifetime,
    }),
    [
      career, version, loading, busy, saveProblem, settings, live, startLive, endLive,
      started, continueCareer, returnToTitle,
      newCareer, playRound, finishSeason, beginNextSeason, abandonCareer,
      dismissSaveProblem, updateSettings, refresh, lifetime,
    ],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const context = useContext(GameContext);
  if (!context) throw new Error('useGame must be used inside a GameProvider');
  return context;
}
