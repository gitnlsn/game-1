import {
  deserializeCareer,
  serializeCareer,
  UnsupportedSaveError,
  type Career,
} from '@game1/engine';

export const SAVE_KEY = 'game1:career:v1';
export const SETTINGS_KEY = 'game1:settings';
/** A save we could not read is moved here rather than deleted. */
export const QUARANTINE_KEY = 'game1:career:unreadable';

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
  matchMode: 'instant' | 'replay';
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
export async function loadCareer(storage: SaveStorage): Promise<LoadResult> {
  let json: string | null = null;
  try {
    json = await storage.getItem(SAVE_KEY);
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

    await quarantine(storage, json);
    return { kind: 'problem', problem };
  }
}

async function quarantine(storage: SaveStorage, json: string): Promise<void> {
  try {
    await storage.setItem(QUARANTINE_KEY, json);
    await storage.removeItem(SAVE_KEY);
  } catch {
    // Best effort: never let quarantining mask the original problem.
  }
}

export async function saveCareer(storage: SaveStorage, career: Career): Promise<void> {
  await storage.setItem(SAVE_KEY, serializeCareer(career));
}

export async function clearCareer(storage: SaveStorage): Promise<void> {
  await storage.removeItem(SAVE_KEY);
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
