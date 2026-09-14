import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  advanceRound,
  deserializeCareer,
  endSeason,
  isSeasonComplete,
  serializeCareer,
  startCareer,
  UnsupportedSaveError,
  type Career,
  type MatchResult,
  type SeasonSummary,
} from '@game1/engine';

const SAVE_KEY = 'game1:career:v1';
const SETTINGS_KEY = 'game1:settings';
/** A save we could not read is moved here rather than deleted. */
const QUARANTINE_KEY = 'game1:career:unreadable';

export interface SaveProblem {
  kind: 'too_new' | 'no_migration_path' | 'damaged';
  message: string;
}

export interface Settings {
  /** Show the match play out minute by minute, or just give the result. */
  matchMode: 'instant' | 'replay';
}

const DEFAULT_SETTINGS: Settings = { matchMode: 'replay' };

export interface RoundOutcome {
  /** The managed club's match, if they played this round. */
  ownMatch: MatchResult | undefined;
  results: MatchResult[];
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
        const settingsJson = await AsyncStorage.getItem(SETTINGS_KEY);
        if (!cancelled && settingsJson) {
          setSettings({ ...DEFAULT_SETTINGS, ...(JSON.parse(settingsJson) as Partial<Settings>) });
        }

        const json = await AsyncStorage.getItem(SAVE_KEY);
        if (!cancelled && json) setCareer(deserializeCareer(json));
      } catch (error) {
        /*
         * A career is hours of someone's time. Move the unreadable save aside
         * and say what went wrong instead of deleting it, so a bad build or a
         * half-written file is recoverable rather than terminal.
         */
        const problem: SaveProblem =
          error instanceof UnsupportedSaveError
            ? { kind: error.reason, message: error.message }
            : { kind: 'damaged', message: 'This save could not be read and may be damaged.' };

        try {
          const json = await AsyncStorage.getItem(SAVE_KEY);
          if (json) await AsyncStorage.setItem(QUARANTINE_KEY, json);
          await AsyncStorage.removeItem(SAVE_KEY);
        } catch {
          // Quarantining is best-effort; never let it mask the original problem.
        }
        if (!cancelled) setSaveProblem(problem);
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
    AsyncStorage.setItem(SAVE_KEY, serializeCareer(next)).catch((error) =>
      console.warn('Could not save', error),
    );
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
      return { ownMatch, results };
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
    AsyncStorage.removeItem(SAVE_KEY).catch(() => {});
  }, []);

  const dismissSaveProblem = useCallback(() => setSaveProblem(undefined), []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
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
