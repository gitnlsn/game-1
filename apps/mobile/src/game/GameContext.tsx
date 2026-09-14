import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  advanceRound,
  deserializeCareer,
  endSeason,
  isSeasonComplete,
  serializeCareer,
  startCareer,
  type Career,
  type MatchResult,
  type SeasonSummary,
} from '@game1/engine';

const SAVE_KEY = 'game1:career:v1';

export interface RoundOutcome {
  /** The managed club's match, if they played this round. */
  ownMatch: MatchResult | undefined;
  results: MatchResult[];
}

interface GameContextValue {
  career: Career | undefined;
  /** Bumped on every mutation, since the engine mutates the world in place. */
  version: number;
  loading: boolean;
  busy: boolean;
  newCareer: (seed: string, managedClubId: string) => void;
  playRound: () => RoundOutcome | undefined;
  finishSeason: () => SeasonSummary | undefined;
  abandonCareer: () => void;
}

const GameContext = createContext<GameContextValue | undefined>(undefined);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [career, setCareer] = useState<Career | undefined>();
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Restore a save on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await AsyncStorage.getItem(SAVE_KEY);
        if (!cancelled && json) setCareer(deserializeCareer(json));
      } catch (error) {
        // A save from an older build is not worth crashing over: start fresh.
        console.warn('Could not load save', error);
        await AsyncStorage.removeItem(SAVE_KEY).catch(() => {});
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

  const playRound = useCallback((): RoundOutcome | undefined => {
    if (!career || isSeasonComplete(career)) return undefined;

    setBusy(true);
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

  const finishSeason = useCallback((): SeasonSummary | undefined => {
    if (!career || !isSeasonComplete(career)) return undefined;

    setBusy(true);
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

  const value = useMemo<GameContextValue>(
    () => ({ career, version, loading, busy, newCareer, playRound, finishSeason, abandonCareer }),
    [career, version, loading, busy, newCareer, playRound, finishSeason, abandonCareer],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const context = useContext(GameContext);
  if (!context) throw new Error('useGame must be used inside a GameProvider');
  return context;
}

/** Narrower hook for screens that cannot render without a career. */
export function useCareer(): Career {
  const { career } = useGame();
  if (!career) throw new Error('useCareer used with no career in progress');
  return career;
}
