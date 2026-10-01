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
  currentTeamSheet,
  setTeamSheet,
  suggestedTeamSheet,
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
  type TransferWindowState,
} from '@eleven-deep/engine';
import {
  clearCareer,
  DEFAULT_SETTINGS,
  emptySlotIndex,
  loadCareer,
  loadSettings,
  loadSlotIndex,
  recoverSlots,
  saveCareer,
  saveSettings,
  saveSlotIndex,
  type SaveProblem,
  type Settings,
  type SlotIndex,
} from './saves';
import { careerSummary } from './summary';
import {
  emptyLifetime,
  endCareer as closeLifetimeCareer,
  forgetCareer,
  loadLifetime,
  newCareerKey,
  recordProgress,
  sameLifetime,
  saveLifetime,
  type LifetimeRecord,
} from './lifetime';
import { submitLifetime } from './playGames';
import { useSubscription } from './subscription';

export type { SaveProblem, Settings, LifetimeRecord, SlotIndex };

export interface RoundOutcome {
  /** The managed club's match, if they played this round. */
  ownMatch: MatchResult | undefined;
}

/** Why a simulated run of rounds stopped. */
export type SimStop = 'complete' | 'sacked' | 'sponsor' | 'window' | 'stopped';

export interface SimOutcome {
  rounds: number;
  /** The managed club's matches, league and cup, in the order played. */
  matches: MatchResult[];
  stoppedFor: SimStop;
}

export interface SimProgress {
  /** Matchdays played so far in this run. */
  played: number;
  /** Matchdays the run would take to finish the season. */
  total: number;
}

/** See `ProState` in pro.ts, which is how screens should read this. */
export interface ProStatus {
  offered: boolean;
  active: boolean;
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
  /**
   * The careers kept in each save slot. The loaded career's own entry can be a
   * save behind; read it off `career` where that matters.
   */
  slots: SlotIndex;
  /** Whether Eleven Deep Pro is on sale here, and whether this player has it. */
  pro: ProStatus;
  /**
   * Plays rounds until the season is over, stopping early for anything that
   * needs the manager: the sack, or a sponsor offer that would otherwise
   * expire unanswered. Pro.
   */
  simToEnd: () => Promise<SimOutcome | undefined>;
  /** Set while `simToEnd` is running. */
  simProgress: SimProgress | undefined;
  /** Stops a running sim after the round in progress. */
  stopSim: () => void;
  /** The slot `career` was loaded from and saves to. */
  activeSlot: number;
  /** Loads the career in another slot and enters it. */
  openSlot: (slot: number) => Promise<void>;
  /** Starts a career in `slot`, replacing whatever was there; the loaded slot by default. */
  newCareer: (
    seed: string,
    managedClubId: string,
    slot?: number,
    options?: { nationality?: string; sandbox?: boolean },
  ) => void;
  playRound: () => Promise<RoundOutcome | undefined>;
  finishSeason: () => Promise<SeasonSummary | undefined>;
  /** Closes the transfer window and starts the new season. */
  beginNextSeason: () => Promise<void>;
  /** True while the close-season window is open and waiting on you. */
  windowOpen: boolean;
  /**
   * The mid-season window, while it is open. Unlike the close-season one it
   * waits for nobody: matches go on, and it shuts by itself.
   */
  midSeasonWindow: TransferWindowState | undefined;
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
 * The lifetime record's key for a save the slot index lost track of, so that
 * returning to it resumes its count rather than banking its history again.
 * Before slots the one save was always the career in progress; after, it is
 * whichever counted career no slot claims. A fresh key is the fallback, and
 * costs a one-off double count of that career's past seasons.
 */
function orphanKey(lifetime: LifetimeRecord, index: SlotIndex, slot: number): string {
  const claimed = new Set(Object.values(index.slots).map((entry) => entry?.careerKey));
  if (slot === index.active && lifetime.current && !claimed.has(lifetime.current.key)) {
    return lifetime.current.key;
  }
  const unclaimed = Object.keys(lifetime.parked).filter((key) => !claimed.has(key));
  if (unclaimed.length === 1) return unclaimed[0]!;
  if (lifetime.current && !claimed.has(lifetime.current.key)) return lifetime.current.key;
  return newCareerKey();
}

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
  const subscription = useSubscription();
  const [career, setCareer] = useState<Career | undefined>();
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saveProblem, setSaveProblem] = useState<SaveProblem | undefined>();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [live, setLive] = useState<LiveMatch | undefined>();
  const [resumed, setResumed] = useState(false);
  const [lifetime, setLifetime] = useState<LifetimeRecord>(emptyLifetime);
  const [slots, setSlots] = useState<SlotIndex>(emptySlotIndex);
  const [simProgress, setSimProgress] = useState<SimProgress | undefined>();
  const stopRequested = useRef(false);

  const pro = useMemo<ProStatus>(
    () =>
      __DEV__ && settings.devPro
        ? { offered: true, active: settings.devPro === 'pro' }
        : { offered: subscription.available, active: subscription.active },
    [settings.devPro, subscription.available, subscription.active],
  );

  /*
   * The assistant re-picks the eleven before every match from who is fit and
   * in form, in the formation the manager last chose. Instructions are kept:
   * `setTeamSheet` carries them over when the new sheet has none.
   */
  const assistantPicks = settings.assistantPicks === true && pro.active;
  const prepareMatch = useCallback(
    (target: Career) => {
      if (!assistantPicks) return;
      const { tactics: _, ...picked } = suggestedTeamSheet(target, currentTeamSheet(target).formation);
      setTeamSheet(target, picked);
    },
    [assistantPicks],
  );

  /*
   * Refs as well as state, for the same reason as the lifetime totals below:
   * `persist` runs on every action and has to write to the slot the career
   * came from, without every action being rebuilt each time the index moves.
   */
  const slotsRef = useRef<SlotIndex>(slots);
  const writeSlots = useCallback((next: SlotIndex) => {
    slotsRef.current = next;
    setSlots(next);
    saveSlotIndex(AsyncStorage, next).catch(() => {});
  }, []);

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
        const stored = await loadSlotIndex(AsyncStorage);
        const index = await recoverSlots(AsyncStorage, stored, careerSummary, (slot) =>
          orphanKey(loadedLifetime, stored, slot),
        );
        const entry = index.slots[index.active];
        if (!cancelled) {
          lifetimeRef.current = loadedLifetime;
          /*
           * A save from before slots has no index entry, and its key is the
           * one the totals were already counting.
           */
          careerKey.current =
            entry?.careerKey ?? (index.active === 0 ? loadedLifetime.current?.key : undefined);
          setLifetime(loadedLifetime);
        }

        const result = await loadCareer(AsyncStorage, index.active);
        if (cancelled) return;
        if (result.kind === 'career') setCareer(result.career);
        else if (result.kind === 'problem') setSaveProblem(result.problem);
        // An entry for a save that is not there any more describes nothing.
        if (result.kind !== 'career' && entry) {
          const { [index.active]: _, ...rest } = index.slots;
          writeSlots({ ...index, slots: rest });
        } else if (index !== stored) {
          writeSlots(index);
        } else {
          slotsRef.current = index;
          setSlots(index);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(
    (next: Career) => {
      const slot = slotsRef.current.active;
      // Fire and forget: the game never blocks on the save completing.
      saveCareer(AsyncStorage, next, slot).catch((error) => console.warn('Could not save', error));
      careerKey.current ??= newCareerKey();
      writeSlots({
        active: slot,
        slots: {
          ...slotsRef.current.slots,
          [slot]: { careerKey: careerKey.current, summary: careerSummary(next), savedAt: Date.now() },
        },
      });
    },
    [writeSlots],
  );

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
    // Nothing in a sandbox was earned, so none of it reaches the leaderboards.
    if (loading || !career || career.sandbox) return;

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
    (
      seed: string,
      managedClubId: string,
      slot: number = slotsRef.current.active,
      options: { nationality?: string; sandbox?: boolean } = {},
    ) => {
      const next = startCareer({
        seed,
        managedClubId,
        ...(options.nationality ? { nationality: options.nationality } : {}),
        // Sandbox is Pro; a lapsed subscriber cannot start one.
        sandbox: options.sandbox === true && pro.active,
      });

      /*
       * The career this replaces is gone, so its bookkeeping goes with it --
       * its matches stay banked in the totals. Before slots it was always the
       * loaded career, whose key may be on nothing but the ref.
       */
      const replaced =
        slotsRef.current.slots[slot]?.careerKey ??
        (slot === slotsRef.current.active ? careerKey.current : undefined);
      if (replaced) {
        const forgotten = forgetCareer(lifetimeRef.current, replaced);
        lifetimeRef.current = forgotten;
        setLifetime(forgotten);
        saveLifetime(AsyncStorage, forgotten).catch(() => {});
      }

      // A new career counts from its own zero, whatever the last one did.
      careerKey.current = newCareerKey();
      slotsRef.current = { ...slotsRef.current, active: slot };
      setLive(undefined);
      setCareer(next);
      // Picking a club is the same decision as pressing Continue.
      setResumed(true);
      setVersion((v) => v + 1);
      persist(next);
    },
    [persist, pro.active],
  );

  const playRound = useCallback(async (): Promise<RoundOutcome | undefined> => {
    if (!career || isSeasonComplete(career)) return undefined;

    setBusy(true);
    // Yield a frame so the spinner actually paints. Both setBusy calls used to
    // sit in one synchronous callback, so React batched them away and the UI
    // simply froze while ten matches simulated.
    await nextFrame();
    try {
      prepareMatch(career);
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
  }, [career, persist, prepareMatch]);

  const simToEnd = useCallback(async (): Promise<SimOutcome | undefined> => {
    if (!career || isSeasonComplete(career) || isSacked(career) || live || !pro.active) return undefined;

    stopRequested.current = false;
    const total = career.season.totalRounds - career.season.nextRound + 1;
    const matches: MatchResult[] = [];
    let rounds = 0;
    let stoppedFor: SimStop = 'complete';
    setBusy(true);
    setSimProgress({ played: 0, total });
    try {
      while (!isSeasonComplete(career)) {
        // One frame per round, so the progress paints and Stop can be pressed.
        await nextFrame();
        if (stopRequested.current) {
          stoppedFor = 'stopped';
          break;
        }
        const offersBefore = pendingSponsorOffers(career).length;
        const windowBefore = transferWindow(career) !== undefined;
        prepareMatch(career);
        const results = advanceRound(career);
        rounds += 1;
        const own = results.find(
          (r) => r.homeClubId === career.managedClubId || r.awayClubId === career.managedClubId,
        );
        if (own) matches.push(own);
        setSimProgress({ played: rounds, total });
        if (isSacked(career)) {
          stoppedFor = 'sacked';
          break;
        }
        if (pendingSponsorOffers(career).length > offersBefore) {
          stoppedFor = 'sponsor';
          break;
        }
        // The window opening is a chance to act that a sim must not play past.
        if (!windowBefore && transferWindow(career)) {
          stoppedFor = 'window';
          break;
        }
      }
      return { rounds, matches, stoppedFor };
    } finally {
      setVersion((v) => v + 1);
      persist(career);
      setSimProgress(undefined);
      setBusy(false);
    }
  }, [career, live, pro.active, persist, prepareMatch]);

  const stopSim = useCallback(() => {
    stopRequested.current = true;
  }, []);

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
    if (!career || !transferWindow(career) || transferWindow(career)?.midSeason) return;

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
      prepareMatch(career);
      const started = beginLiveMatch(career);
      if (started) {
        setLive(started);
        setVersion((v) => v + 1);
      }
      return started;
    } finally {
      setBusy(false);
    }
  }, [career, live, prepareMatch]);

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
    const slot = slotsRef.current.active;
    setCareer(undefined);
    setLive(undefined);
    setVersion((v) => v + 1);
    clearCareer(AsyncStorage, slot).catch(() => {});
    const { [slot]: _, ...rest } = slotsRef.current.slots;
    writeSlots({ ...slotsRef.current, slots: rest });

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
  }, [writeSlots]);

  const openSlot = useCallback(
    async (slot: number): Promise<void> => {
      if (live) return;
      if (slot === slotsRef.current.active && career) {
        setResumed(true);
        return;
      }
      const entry = slotsRef.current.slots[slot];
      setBusy(true);
      await nextFrame();
      try {
        // The career being left needs nothing: it was saved after its last action.
        const result = await loadCareer(AsyncStorage, slot);
        if (result.kind !== 'career') {
          if (result.kind === 'problem') setSaveProblem(result.problem);
          const { [slot]: _, ...rest } = slotsRef.current.slots;
          writeSlots({ ...slotsRef.current, slots: rest });
          return;
        }
        careerKey.current = entry?.careerKey ?? newCareerKey();
        writeSlots({ ...slotsRef.current, active: slot });
        setCareer(result.career);
        setResumed(true);
        setVersion((v) => v + 1);
      } finally {
        setBusy(false);
      }
    },
    [career, live, writeSlots],
  );

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
      windowOpen: !!career && !!transferWindow(career) && !transferWindow(career)?.midSeason,
      midSeasonWindow: career && transferWindow(career)?.midSeason ? transferWindow(career) : undefined,
      sponsorOffersWaiting: career ? pendingSponsorOffers(career).length : 0,
      sacked: !!career && isSacked(career),
      started, continueCareer, returnToTitle,
      slots, activeSlot: slots.active, openSlot, pro, simToEnd, simProgress, stopSim,
      newCareer, playRound, finishSeason, beginNextSeason, abandonCareer,
      dismissSaveProblem, updateSettings, refresh, lifetime,
    }),
    [
      career, version, loading, busy, saveProblem, settings, live, startLive, endLive,
      started, continueCareer, returnToTitle, slots, openSlot, pro, simToEnd, simProgress, stopSim,
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
