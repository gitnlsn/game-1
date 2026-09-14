import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  advanceRound,
  endSeason,
  isSeasonComplete,
  startCareer,
  type Career,
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
  abandonCareer: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
}

const GameContext = createContext<GameContextValue | undefined>(undefined);

/** Lets React paint before a long synchronous block runs. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [career, setCareer] = useState<Career | undefined>();
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saveProblem, setSaveProblem] = useState<SaveProblem | undefined>();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

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

  const abandonCareer = useCallback(() => {
    setCareer(undefined);
    setVersion((v) => v + 1);
    clearCareer(AsyncStorage).catch(() => {});
  }, []);

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
      career, version, loading, busy, saveProblem, settings,
      newCareer, playRound, finishSeason, abandonCareer, dismissSaveProblem, updateSettings,
    }),
    [
      career, version, loading, busy, saveProblem, settings,
      newCareer, playRound, finishSeason, abandonCareer, dismissSaveProblem, updateSettings,
    ],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const context = useContext(GameContext);
  if (!context) throw new Error('useGame must be used inside a GameProvider');
  return context;
}
