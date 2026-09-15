import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  advanceRound,
  beginLiveMatch,
  endLiveMatch,
  endSeason,
  isSacked,
  isSeasonComplete,
  startCareer,
  startNextSeason,
  transferWindow,
  type Career,
  type LiveMatch,
  type MatchResult,
  type SeasonSummary,
} from '@game1/engine';
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

export type { SaveProblem, Settings };

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
  newCareer: (seed: string, managedClubId: string) => void;
  playRound: () => Promise<RoundOutcome | undefined>;
  finishSeason: () => Promise<SeasonSummary | undefined>;
  /** Closes the transfer window and starts the new season. */
  beginNextSeason: () => Promise<void>;
  /** True while the close-season window is open and waiting on you. */
  windowOpen: boolean;
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

  // Restore a save on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loadedSettings = await loadSettings(AsyncStorage);
        if (!cancelled) setSettings(loadedSettings);

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

  const newCareer = useCallback(
    (seed: string, managedClubId: string) => {
      const next = startCareer({ seed, managedClubId });
      setCareer(next);
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

  const abandonCareer = useCallback(() => {
    setCareer(undefined);
    setLive(undefined);
    setVersion((v) => v + 1);
    clearCareer(AsyncStorage).catch(() => {});
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
      sacked: !!career && isSacked(career),
      newCareer, playRound, finishSeason, beginNextSeason, abandonCareer,
      dismissSaveProblem, updateSettings, refresh,
    }),
    [
      career, version, loading, busy, saveProblem, settings, live, startLive, endLive,
      newCareer, playRound, finishSeason, beginNextSeason, abandonCareer,
      dismissSaveProblem, updateSettings, refresh,
    ],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const context = useContext(GameContext);
  if (!context) throw new Error('useGame must be used inside a GameProvider');
  return context;
}
