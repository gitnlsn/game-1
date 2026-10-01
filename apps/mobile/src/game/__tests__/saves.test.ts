import { beforeEach, describe, expect, it } from 'vitest';
import {
  allClubs,
  advanceRound,
  isSeasonComplete,
  serializeCareer,
  startCareer,
  type Career,
} from '@eleven-deep/engine';
import {
  clearCareer,
  DEFAULT_SETTINGS,
  loadCareer,
  loadSettings,
  QUARANTINE_KEY,
  SAVE_KEY,
  saveCareer,
  saveSettings,
  SETTINGS_KEY,
  emptySlotIndex,
  firstEmptySlot,
  FREE_SLOTS,
  loadSlotIndex,
  quarantineKey,
  recoverSlots,
  saveSlotIndex,
  SLOT_COUNT,
  SLOT_INDEX_KEY,
  slotKey,
  type SaveStorage,
} from '../saves';

/** Stands in for AsyncStorage, and can be made to fail on demand. */
class FakeStorage implements SaveStorage {
  readonly items = new Map<string, string>();
  failReads = false;
  failWrites = false;

  async getItem(key: string): Promise<string | null> {
    if (this.failReads) throw new Error('storage unavailable');
    return this.items.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    if (this.failWrites) throw new Error('disk full');
    this.items.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.items.delete(key);
  }
}

function playedCareer(seed = 'app-saves'): Career {
  const career = startCareer({ seed });
  for (let i = 0; i < 3 && !isSeasonComplete(career); i++) advanceRound(career);
  return career;
}

describe('loadCareer', () => {
  let storage: FakeStorage;
  beforeEach(() => {
    storage = new FakeStorage();
  });

  it('reports an empty slot rather than failing', async () => {
    expect(await loadCareer(storage)).toEqual({ kind: 'empty' });
  });

  it('round-trips a career', async () => {
    const career = playedCareer();
    await saveCareer(storage, career);

    const result = await loadCareer(storage);
    expect(result.kind).toBe('career');
    if (result.kind !== 'career') return;

    expect(result.career.managedClubId).toBe(career.managedClubId);
    expect(result.career.season.results).toHaveLength(career.season.results.length);
    expect(result.career.world.players.size).toBe(career.world.players.size);
  });

  it('quarantines a damaged save instead of deleting it', async () => {
    storage.items.set(SAVE_KEY, '{ this is not json');

    const result = await loadCareer(storage);
    expect(result.kind).toBe('problem');
    if (result.kind !== 'problem') return;
    expect(result.problem.kind).toBe('damaged');

    // The career is hours of someone's time: it must still be there.
    expect(storage.items.get(QUARANTINE_KEY)).toBe('{ this is not json');
    expect(storage.items.has(SAVE_KEY)).toBe(false);
  });

  it('distinguishes a save from a newer build', async () => {
    const saved = JSON.parse(serializeCareer(playedCareer()));
    saved.version = 999;
    storage.items.set(SAVE_KEY, JSON.stringify(saved));

    const result = await loadCareer(storage);
    expect(result.kind).toBe('problem');
    if (result.kind !== 'problem') return;
    expect(result.problem.kind).toBe('too_new');
    expect(result.problem.message).toMatch(/newer build/i);
    expect(storage.items.has(QUARANTINE_KEY)).toBe(true);
  });

  it('distinguishes a save too old to upgrade', async () => {
    const saved = JSON.parse(serializeCareer(playedCareer()));
    saved.version = 0;
    storage.items.set(SAVE_KEY, JSON.stringify(saved));

    const result = await loadCareer(storage);
    expect(result.kind).toBe('problem');
    if (result.kind !== 'problem') return;
    expect(result.problem.kind).toBe('no_migration_path');
  });

  it('upgrades a save from an older format', async () => {
    // A genuine version-1 shape: no scouting, no team sheets, and potential
    // under its old name.
    const saved = JSON.parse(serializeCareer(playedCareer()));
    saved.version = 1;
    delete saved.scouting;
    delete saved.season.teamSheets;
    for (const club of saved.clubs) {
      for (const player of club.squad) {
        player.potential = player.hiddenPotential;
        delete player.hiddenPotential;
      }
    }
    storage.items.set(SAVE_KEY, JSON.stringify(saved));

    const result = await loadCareer(storage);
    expect(result.kind).toBe('career');
    if (result.kind !== 'career') return;
    expect(result.career.scouting.reports).toEqual({});
    expect(result.career.season.teamSheets.size).toBe(0);
    // And nothing is left holding an undefined potential.
    for (const club of allClubs(result.career.world)) {
      for (const player of club.squad) {
        expect(Number.isFinite(player.hiddenPotential)).toBe(true);
      }
    }
  });

  it('survives storage being unreadable', async () => {
    storage.failReads = true;
    const result = await loadCareer(storage);
    expect(result.kind).toBe('problem');
  });

  it('does not lose the save when quarantining fails', async () => {
    storage.items.set(SAVE_KEY, 'broken');
    storage.failWrites = true;

    const result = await loadCareer(storage);
    expect(result.kind).toBe('problem');
    // Quarantine could not be written, so the original must not be removed.
    expect(storage.items.get(SAVE_KEY)).toBe('broken');
  });
});

describe('clearCareer', () => {
  it('removes the save', async () => {
    const storage = new FakeStorage();
    await saveCareer(storage, playedCareer());
    await clearCareer(storage);
    expect(await loadCareer(storage)).toEqual({ kind: 'empty' });
  });
});

describe('settings', () => {
  it('defaults when nothing is stored', async () => {
    expect(await loadSettings(new FakeStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips, and fills in anything a newer build added', async () => {
    const storage = new FakeStorage();
    await saveSettings(storage, { matchMode: 'instant' });
    expect(await loadSettings(storage)).toEqual({ matchMode: 'instant' });

    // A partial blob from an older build must not leave fields undefined.
    storage.items.set(SETTINGS_KEY, '{}');
    expect(await loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back rather than crashing on a corrupt blob', async () => {
    const storage = new FakeStorage();
    storage.items.set(SETTINGS_KEY, 'not json');
    expect(await loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('save slots', () => {
  let storage: FakeStorage;
  beforeEach(() => {
    storage = new FakeStorage();
  });

  it('keeps slot 0 at the key saves have always used', async () => {
    expect(slotKey(0)).toBe(SAVE_KEY);
    const career = playedCareer();
    storage.items.set(SAVE_KEY, serializeCareer(career));

    const loaded = await loadCareer(storage, 0);
    expect(loaded.kind).toBe('career');
  });

  it('keeps each slot apart', async () => {
    const one = playedCareer('slot-one');
    const two = playedCareer('slot-two');
    await saveCareer(storage, one, 0);
    await saveCareer(storage, two, 2);

    expect(await loadCareer(storage, 1)).toEqual({ kind: 'empty' });
    const loaded = await loadCareer(storage, 2);
    expect(loaded.kind === 'career' && loaded.career.world.seed).toBe(two.world.seed);

    await clearCareer(storage, 2);
    expect(await loadCareer(storage, 2)).toEqual({ kind: 'empty' });
    expect((await loadCareer(storage, 0)).kind).toBe('career');
  });

  it('quarantines a damaged slot without touching the others', async () => {
    await saveCareer(storage, playedCareer(), 0);
    storage.items.set(slotKey(1), '{ broken');

    expect((await loadCareer(storage, 1)).kind).toBe('problem');
    expect(storage.items.has(quarantineKey(1))).toBe(true);
    expect(storage.items.has(QUARANTINE_KEY)).toBe(false);
    expect((await loadCareer(storage, 0)).kind).toBe('career');
  });

  it('reads a missing or corrupt index as empty, and an out-of-range slot as slot 0', async () => {
    expect(await loadSlotIndex(storage)).toEqual(emptySlotIndex());
    storage.items.set(SLOT_INDEX_KEY, 'nope');
    expect(await loadSlotIndex(storage)).toEqual(emptySlotIndex());
    storage.items.set(SLOT_INDEX_KEY, JSON.stringify({ active: 9, slots: {} }));
    expect((await loadSlotIndex(storage)).active).toBe(0);
  });

  it('round-trips the index', async () => {
    const index = {
      active: 1,
      slots: { 1: { careerKey: 'k', summary: { clubName: 'X' } as never, savedAt: 5 } },
    };
    await saveSlotIndex(storage, index);
    expect(await loadSlotIndex(storage)).toEqual(index);
  });

  it('finds the first free slot among those the player may use', () => {
    expect(firstEmptySlot(new Set(), 1)).toBe(0);
    expect(firstEmptySlot(new Set([0]), FREE_SLOTS)).toBeUndefined();
    expect(firstEmptySlot(new Set([0, 2]), SLOT_COUNT)).toBe(1);
    expect(firstEmptySlot(new Set([0, 1, 2]), SLOT_COUNT)).toBeUndefined();
  });
});

describe('recoverSlots', () => {
  it('indexes a save nothing points at, and leaves indexed slots alone', async () => {
    const storage = new FakeStorage();
    const legacy = playedCareer('recover-legacy');
    await saveCareer(storage, legacy, 0);
    await saveCareer(storage, playedCareer('recover-new'), 1);
    const index = {
      active: 1,
      slots: { 1: { careerKey: 'new', summary: { clubName: 'Kept' } as never, savedAt: 9 } },
    };

    const recovered = await recoverSlots(storage, index, (c) => ({ clubName: c.world.seed }) as never, () => 'old');

    expect(recovered.slots[0]).toEqual({ careerKey: 'old', summary: { clubName: legacy.world.seed }, savedAt: 0 });
    expect(recovered.slots[1]).toBe(index.slots[1]);
    expect(recovered.slots[2]).toBeUndefined();
  });

  it('returns the same index when there is nothing to recover', async () => {
    const index = emptySlotIndex();
    expect(await recoverSlots(new FakeStorage(), index, () => ({}) as never, () => 'k')).toBe(index);
  });
});
