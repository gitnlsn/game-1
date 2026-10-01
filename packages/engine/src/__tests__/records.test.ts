import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  allTimeAtClub,
  deserializeCareer,
  endSeason,
  honoursOf,
  isSacked,
  isSeasonComplete,
  managedClub,
  MAX_NAME_LENGTH,
  renameClub,
  renamePlayer,
  sandboxGrant,
  serializeCareer,
  startCareer,
  startNextSeason,
  type Career,
} from '../career/index.js';
import { findClub } from '../world/index.js';

function playSeason(career: Career): void {
  let guard = 0;
  while (!isSeasonComplete(career) && guard++ < 100) advanceRound(career);
  endSeason(career);
}

describe('club records', () => {
  it('writes down each season before the close season wipes the numbers', () => {
    const career = startCareer({ seed: 'records-season', managedClubId: 'c3' });
    const squadIds = new Set(managedClub(career).squad.map((p) => p.id));
    playSeason(career);

    const [line] = career.records.seasons;
    expect(career.records.seasons).toHaveLength(1);
    expect(line!.season).toBe(1);
    expect(line!.played).toBeGreaterThan(0);
    expect(line!.won + line!.drawn + line!.lost).toBe(line!.played);
    expect(line!.position).toBeGreaterThan(0);

    // The squad's numbers survived the reset, and add up to the goals scored.
    const lines = Object.entries(career.records.players).filter(([id]) => squadIds.has(id));
    expect(lines.length).toBeGreaterThan(11);
    const goals = lines.reduce((sum, [, seasons]) => sum + seasons[0]!.goals, 0);
    expect(goals).toBeGreaterThan(0);
    expect(goals).toBeLessThanOrEqual(line!.goalsFor + 60); // cup goals count for players too

    expect(career.records.biggestWin ?? career.records.heaviestDefeat).toBeDefined();
  });

  it('adds up a player across seasons at the club', () => {
    const career = startCareer({ seed: 'records-alltime', managedClubId: 'c3' });
    playSeason(career);
    startNextSeason(career);
    playSeason(career);

    const clubId = career.managedClubId;
    const allTime = allTimeAtClub(career.records, clubId);
    const twoSeasons = allTime.find((line) => line.seasons === 2);
    expect(twoSeasons).toBeDefined();
    const lines = career.records.players[twoSeasons!.playerId]!.filter((l) => l.clubId === clubId);
    expect(twoSeasons!.appearances).toBe(lines[0]!.appearances + lines[1]!.appearances);
    // Most appearances first.
    for (let i = 1; i < allTime.length; i++) {
      expect(allTime[i - 1]!.appearances).toBeGreaterThanOrEqual(allTime[i]!.appearances);
    }
    expect(honoursOf(career.records).bestFinish).toBeDefined();
  });

  it('survives a save, and rebuilds the season lines for a save from before records', () => {
    const career = startCareer({ seed: 'records-save', managedClubId: 'c3' });
    playSeason(career);
    const loaded = deserializeCareer(serializeCareer(career));
    expect(loaded.records).toEqual(career.records);

    const old = JSON.parse(serializeCareer(career)) as Record<string, unknown>;
    old.version = 10;
    delete old.records;
    delete old.sandbox;
    const migrated = deserializeCareer(JSON.stringify(old));
    expect(migrated.sandbox).toBe(false);
    expect(migrated.records.players).toEqual({});
    expect(migrated.records.seasons).toHaveLength(1);
    const [rebuilt] = migrated.records.seasons;
    const [kept] = career.records.seasons;
    expect(rebuilt).toMatchObject({
      season: kept!.season,
      position: kept!.position,
      points: kept!.points,
      played: kept!.played,
    });
  });
});

describe('sandbox', () => {
  it('only adds money in a sandbox career', () => {
    const normal = startCareer({ seed: 'sandbox-normal' });
    const before = managedClub(normal).finances.balance;
    expect(sandboxGrant(normal, 1_000_000)).toBe(false);
    expect(managedClub(normal).finances.balance).toBe(before);

    const sandbox = startCareer({ seed: 'sandbox-on', sandbox: true });
    const start = managedClub(sandbox).finances.balance;
    const budget = managedClub(sandbox).finances.transferBudget;
    expect(sandboxGrant(sandbox, 1_000_000)).toBe(true);
    expect(managedClub(sandbox).finances.balance).toBe(start + 1_000_000);
    expect(managedClub(sandbox).finances.transferBudget).toBe(budget + 1_000_000);
    expect(sandboxGrant(sandbox, -5)).toBe(false);
    expect(deserializeCareer(serializeCareer(sandbox)).sandbox).toBe(true);
  });

  it('is never sacked, however bad it gets', () => {
    const career = startCareer({ seed: 'sandbox-sack', sandbox: true });
    for (let season = 0; season < 3; season++) {
      career.board.confidence = 0;
      career.board.expectation = 1;
      playSeason(career);
      expect(isSacked(career)).toBe(false);
      startNextSeason(career);
    }
  });
});

describe('editor', () => {
  it('renames a player and keeps first and last names in step', () => {
    const career = startCareer({ seed: 'edit-player' });
    const player = managedClub(career).squad[0]!;
    expect(renamePlayer(career, player.id, '  Ronaldo   Nazário ')).toBe(true);
    expect(player.displayName).toBe('Ronaldo Nazário');
    expect(player.firstName).toBe('Ronaldo');
    expect(player.lastName).toBe('Nazário');

    expect(renamePlayer(career, player.id, '   ')).toBe(false);
    expect(renamePlayer(career, player.id, 'x'.repeat(MAX_NAME_LENGTH + 1))).toBe(false);
    expect(renamePlayer(career, 'nobody', 'Name')).toBe(false);
    expect(player.displayName).toBe('Ronaldo Nazário');
  });

  it('renames a club, its city and its short name', () => {
    const career = startCareer({ seed: 'edit-club' });
    const id = career.managedClubId;
    expect(renameClub(career, id, { name: 'Sport Club Recife', city: 'Recife' })).toBe(true);
    const club = findClub(career.world, id)!;
    expect(club.name).toBe('Sport Club Recife');
    expect(club.city).toBe('Recife');
    expect(club.shortName).toBe('REC');
    expect(renameClub(career, id, { name: '' })).toBe(false);
    expect(club.name).toBe('Sport Club Recife');
  });
});
