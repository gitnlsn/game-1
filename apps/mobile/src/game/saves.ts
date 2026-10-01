import {
  deserializeCareer,
  serializeCareer,
  UnsupportedSaveError,
  type Career,
} from '@eleven-deep/engine';
import type { CareerSummary } from './summary';

/*
 * Deliberately still `game1:`, which the app has not been called since it was
 * named. These are the addresses of saves already sitting on devices: rename
 * them and every one of those careers becomes unreachable, with the app
 * reporting no save rather than a broken one, which is worse. A storage key is
 * an identifier, not a label.
 */
export const SAVE_KEY = 'game1:career:v1';
export const SETTINGS_KEY = 'game1:settings';
/** A save we could not read is moved here rather than deleted. */
export const QUARANTINE_KEY = 'game1:career:unreadable';
/** Which slots hold a career, and what to say about each without loading it. */
export const SLOT_INDEX_KEY = 'game1:slots:v1';

/**
 * Careers that can be kept at once. Slot 0 is everyone's; the rest are Pro.
 * Slot 0 lives at `SAVE_KEY` so the save already on a device simply becomes it.
 */
export const SLOT_COUNT = 3;
export const FREE_SLOTS = 1;

export function slotKey(slot: number): string {
  return slot === 0 ? SAVE_KEY : `${SAVE_KEY}:slot${slot + 1}`;
}

export function quarantineKey(slot: number): string {
  return slot === 0 ? QUARANTINE_KEY : `${QUARANTINE_KEY}:slot${slot + 1}`;
}

/** What the title screen shows for a career it has not loaded. */
export interface SlotEntry {
  /** The lifetime record's identity for this career; see `newCareerKey`. */
  careerKey: string;
  summary: CareerSummary;
  /** When it was last saved, ms since epoch: the most recent is Continue. */
  savedAt: number;
}

export interface SlotIndex {
  /** The slot loaded on launch. */
  active: number;
  slots: Partial<Record<number, SlotEntry>>;
}

export function emptySlotIndex(): SlotIndex {
  return { active: 0, slots: {} };
}

/**
 * The slice of AsyncStorage this module needs. Narrow on purpose: it keeps the
 * save logic free of React Native, so it can be tested directly rather than
 * through a rendered component.
 */
export interface SaveStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SaveProblem {
  kind: 'too_new' | 'no_migration_path' | 'damaged';
  message: string;
}

export interface Settings {
  /** Show the match play out minute by minute, or just give the result. */
  /**
   * `instant` shows the finished result, `replay` plays its timeline back, and
   * `live` plays the match as you watch, with substitutions available.
   */
  matchMode: 'instant' | 'replay' | 'live';
  /**
   * Development builds only: pretend to be a free player who could subscribe,
   * or a subscriber. Billing only exists on an Android build with Play behind
   * it, and both sides of every Pro feature still have to be built and looked
   * at on the web. Unset means ask Play; ignored outside `__DEV__`.
   */
  devPro?: 'free' | 'pro';
  /** Pro: the assistant re-picks the eleven before every match. */
  assistantPicks?: boolean;
}

export const DEFAULT_SETTINGS: Settings = { matchMode: 'replay' };

export type LoadResult =
  | { kind: 'career'; career: Career }
  | { kind: 'empty' }
  | { kind: 'problem'; problem: SaveProblem };

/**
 * Reads the saved career.
 *
 * A career is hours of someone's time, so an unreadable one is moved aside and
 * explained rather than deleted -- and the two failures are distinguished,
 * because "made by a newer build" and "damaged" need different advice.
 */
export async function loadCareer(storage: SaveStorage, slot = 0): Promise<LoadResult> {
  let json: string | null = null;
  try {
    json = await storage.getItem(slotKey(slot));
  } catch {
    return { kind: 'problem', problem: { kind: 'damaged', message: 'Storage could not be read.' } };
  }
  if (!json) return { kind: 'empty' };

  try {
    return { kind: 'career', career: deserializeCareer(json) };
  } catch (error) {
    const problem: SaveProblem =
      error instanceof UnsupportedSaveError
        ? { kind: error.reason, message: error.message }
        : { kind: 'damaged', message: 'This save could not be read and may be damaged.' };

    await quarantine(storage, json, slot);
    return { kind: 'problem', problem };
  }
}

async function quarantine(storage: SaveStorage, json: string, slot: number): Promise<void> {
  try {
    await storage.setItem(quarantineKey(slot), json);
    await storage.removeItem(slotKey(slot));
  } catch {
    // Best effort: never let quarantining mask the original problem.
  }
}

export async function saveCareer(storage: SaveStorage, career: Career, slot = 0): Promise<void> {
  await storage.setItem(slotKey(slot), serializeCareer(career));
}

export async function clearCareer(storage: SaveStorage, slot = 0): Promise<void> {
  await storage.removeItem(slotKey(slot));
}

/**
 * The slot index. Missing or unreadable is not a problem worth reporting: the
 * index only describes saves, and slot 0 is found without it, which is all a
 * device that predates slots has.
 */
export async function loadSlotIndex(storage: SaveStorage): Promise<SlotIndex> {
  try {
    const json = await storage.getItem(SLOT_INDEX_KEY);
    if (!json) return emptySlotIndex();
    const parsed = JSON.parse(json) as Partial<SlotIndex>;
    const active = typeof parsed.active === 'number' && parsed.active >= 0 && parsed.active < SLOT_COUNT
      ? parsed.active
      : 0;
    return { active, slots: parsed.slots ?? {} };
  } catch {
    return emptySlotIndex();
  }
}

export async function saveSlotIndex(storage: SaveStorage, index: SlotIndex): Promise<void> {
  await storage.setItem(SLOT_INDEX_KEY, JSON.stringify(index));
}

/**
 * Gives an index entry to any save that has none, so no career on the device
 * can go missing from the title screen.
 *
 * The case it exists for: a save from before slots is only indexed when it is
 * next saved, so starting a career in another slot first would leave it on
 * disk with nothing pointing at it. `keyFor` names the lifetime record's key
 * for it, when the record can tell.
 */
export async function recoverSlots(
  storage: SaveStorage,
  index: SlotIndex,
  describe: (career: Career) => CareerSummary,
  keyFor: (slot: number) => string,
): Promise<SlotIndex> {
  let slots = index.slots;
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    if (slots[slot]) continue;
    let json: string | null = null;
    try {
      json = await storage.getItem(slotKey(slot));
    } catch {
      continue;
    }
    if (!json) continue;
    try {
      const career = deserializeCareer(json);
      slots = { ...slots, [slot]: { careerKey: keyFor(slot), summary: describe(career), savedAt: 0 } };
    } catch {
      // Unreadable saves are dealt with when someone opens them.
    }
  }
  return slots === index.slots ? index : { ...index, slots };
}

/** The first slot with nothing in it among those this player may use. */
export function firstEmptySlot(taken: ReadonlySet<number>, usable: number): number | undefined {
  for (let slot = 0; slot < usable; slot++) if (!taken.has(slot)) return slot;
  return undefined;
}

export async function loadSettings(storage: SaveStorage): Promise<Settings> {
  try {
    const json = await storage.getItem(SETTINGS_KEY);
    if (!json) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(json) as Partial<Settings>) };
  } catch {
    // A corrupt settings blob is not worth bothering anyone about.
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(storage: SaveStorage, settings: Settings): Promise<void> {
  await storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
