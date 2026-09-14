import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  clearTeamSheet,
  currentTeamSheet,
  managedClub,
  previewLineup,
  setTeamSheet,
  startCareer,
  suggestedTeamSheet,
} from '../career/controller.js';
import { deserializeCareer, serializeCareer } from '../career/persistence.js';
import { resolveTeamSheet } from '../match/ratings.js';
import { currentAbility } from '../world/players.js';
import { FORMATIONS } from '../world/positions.js';
import type { TeamSheet } from '../types.js';

describe('team sheets', () => {
  it('auto-picks exactly as the engine always did when none is set', () => {
    const career = startCareer({ seed: 'selection-auto' });
    const club = managedClub(career);

    const auto = resolveTeamSheet(club, undefined).lineup;
    const viaSheet = resolveTeamSheet(club, suggestedTeamSheet(career)).lineup;

    // The suggested sheet is the auto-pick written down, so the feature is
    // strictly additive and a regression would be obvious.
    expect(viaSheet.slots.map((s) => s.player.id)).toEqual(auto.slots.map((s) => s.player.id));
  });

  it('fields the players the manager named', () => {
    const career = startCareer({ seed: 'selection-honour' });
    const club = managedClub(career);

    // Deliberately pick the worst available outfielders, to prove it is not
    // quietly falling back to the auto-pick.
    const ranked = [...club.squad]
      .filter((p) => p.position !== 'GK')
      .sort((a, b) => currentAbility(a) - currentAbility(b));
    const keeper = club.squad.find((p) => p.position === 'GK')!;

    const formation = FORMATIONS['4-3-3']!;
    const sheet: TeamSheet = {
      clubId: club.id,
      formation: '4-3-3',
      starters: formation.map((position, i) => (position === 'GK' ? keeper.id : ranked[i]!.id)),
      bench: [],
    };

    const issues = setTeamSheet(career, sheet);
    expect(issues).toEqual([]);

    const { lineup } = previewLineup(career);
    expect(lineup.slots.map((s) => s.player.id).sort()).toEqual(
      sheet.starters.filter((id): id is string => id !== undefined).sort(),
    );
  });

  it('fills only the slots left blank', () => {
    const career = startCareer({ seed: 'selection-partial' });
    const club = managedClub(career);
    const pinned = club.squad.filter((p) => p.position === 'ST')[0]!;

    const sheet: TeamSheet = {
      clubId: club.id,
      formation: '4-3-3',
      starters: FORMATIONS['4-3-3']!.map((position) => (position === 'ST' ? pinned.id : undefined)),
      bench: [],
    };

    expect(setTeamSheet(career, sheet)).toEqual([]);
    const { lineup } = previewLineup(career);
    expect(lineup.slots).toHaveLength(11);
    expect(lineup.slots.some((s) => s.player.id === pinned.id)).toBe(true);
    expect(new Set(lineup.slots.map((s) => s.player.id)).size).toBe(11);
  });

  it('replaces an injured pick and keeps the rest of the sheet', () => {
    const career = startCareer({ seed: 'selection-injury' });
    const club = managedClub(career);

    setTeamSheet(career, suggestedTeamSheet(career));
    const before = previewLineup(career).lineup.slots.map((s) => s.player.id);

    // Injure one of the eleven.
    const casualty = club.squad.find((p) => p.id === before[5])!;
    casualty.status.injuryMatches = 4;

    const { lineup, issues } = previewLineup(career);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe('injured');
    expect(issues[0]!.playerId).toBe(casualty.id);
    expect(issues[0]!.replacementId).toBeDefined();

    // Only that slot changed; the rest of the manager's selection survives.
    const after = lineup.slots.map((s) => s.player.id);
    expect(after.filter((id) => !before.includes(id))).toHaveLength(1);
    expect(after).not.toContain(casualty.id);

    // And crucially the sheet itself is untouched, so he returns when fit.
    expect(currentTeamSheet(career).starters).toContain(casualty.id);
    casualty.status.injuryMatches = 0;
    expect(previewLineup(career).lineup.slots.map((s) => s.player.id)).toEqual(before);
  });

  it('ignores a player who has left, and a name listed twice', () => {
    const career = startCareer({ seed: 'selection-stale' });
    const club = managedClub(career);
    const keeper = club.squad.find((p) => p.position === 'GK')!;

    const sheet: TeamSheet = {
      clubId: club.id,
      formation: '4-3-3',
      starters: [keeper.id, 'p-nonexistent', keeper.id, ...new Array(8).fill(undefined)],
      bench: [],
    };

    const issues = setTeamSheet(career, sheet);
    expect(issues.some((i) => i.kind === 'not_in_squad')).toBe(true);
    expect(issues.some((i) => i.kind === 'duplicate')).toBe(true);

    const { lineup } = previewLineup(career);
    expect(lineup.slots).toHaveLength(11);
    expect(new Set(lineup.slots.map((s) => s.player.id)).size).toBe(11);
  });

  it('falls back when the formation is not recognised', () => {
    const career = startCareer({ seed: 'selection-formation' });
    const sheet: TeamSheet = {
      clubId: managedClub(career).id,
      formation: '5-5-5',
      starters: new Array(11).fill(undefined),
      bench: [],
    };

    const issues = setTeamSheet(career, sheet);
    expect(issues.some((i) => i.kind === 'unknown_formation')).toBe(true);
    expect(previewLineup(career).lineup.slots).toHaveLength(11);
  });

  it('honours a different formation', () => {
    const career = startCareer({ seed: 'selection-442' });
    setTeamSheet(career, { ...suggestedTeamSheet(career, '4-4-2'), formation: '4-4-2' });

    const { lineup } = previewLineup(career);
    expect(lineup.formation).toBe('4-4-2');
    expect(lineup.slots.filter((s) => s.position === 'ST')).toHaveLength(2);
  });

  it('is what actually takes the pitch', () => {
    const career = startCareer({ seed: 'selection-fielded' });
    setTeamSheet(career, suggestedTeamSheet(career));
    const picked = new Set(previewLineup(career).lineup.slots.map((s) => s.player.id));

    advanceRound(career);

    // Everyone the manager picked got minutes.
    for (const player of managedClub(career).squad) {
      if (picked.has(player.id)) {
        expect(player.status.minutes, player.displayName).toBeGreaterThan(0);
      }
    }
  });

  it('survives a save, and can be handed back to the engine', () => {
    const career = startCareer({ seed: 'selection-save' });
    const club = managedClub(career);
    const pinned = club.squad.find((p) => p.position === 'ST')!;

    setTeamSheet(career, {
      clubId: club.id,
      formation: '4-2-3-1',
      starters: FORMATIONS['4-2-3-1']!.map((p) => (p === 'ST' ? pinned.id : undefined)),
      bench: [],
    });

    const loaded = deserializeCareer(serializeCareer(career));
    const sheet = currentTeamSheet(loaded);
    expect(sheet.formation).toBe('4-2-3-1');
    expect(sheet.starters).toContain(pinned.id);

    clearTeamSheet(loaded);
    expect(loaded.season.teamSheets.size).toBe(0);
  });

  it('upgrades a save written before team selection existed', () => {
    const career = startCareer({ seed: 'selection-migrate' });
    const saved = JSON.parse(serializeCareer(career));
    delete saved.season.teamSheets;
    saved.version = 2;

    const loaded = deserializeCareer(JSON.stringify(saved));
    expect(loaded.season.teamSheets.size).toBe(0);
    expect(() => advanceRound(loaded)).not.toThrow();
  });

  it('punishes a deliberately bad selection', () => {
    const play = (useWorstXI: boolean) => {
      const career = startCareer({ seed: 'selection-quality', managedClubId: 'c1' });
      const club = managedClub(career);

      if (useWorstXI) {
        const keeper = [...club.squad]
          .filter((p) => p.position === 'GK')
          .sort((a, b) => currentAbility(a) - currentAbility(b))[0]!;
        const worst = [...club.squad]
          .filter((p) => p.position !== 'GK')
          .sort((a, b) => currentAbility(a) - currentAbility(b));
        setTeamSheet(career, {
          clubId: club.id,
          formation: '4-3-3',
          starters: FORMATIONS['4-3-3']!.map((pos, i) => (pos === 'GK' ? keeper.id : worst[i]!.id)),
          bench: [],
        });
      }

      for (let i = 0; i < 19; i++) advanceRound(career);
      const row = career.season.results
        .filter((r) => r.homeClubId === 'c1' || r.awayClubId === 'c1')
        .reduce((pts, r) => {
          const home = r.homeClubId === 'c1';
          const own = home ? r.home.goals : r.away.goals;
          const other = home ? r.away.goals : r.home.goals;
          return pts + (own > other ? 3 : own === other ? 1 : 0);
        }, 0);
      return row;
    };

    // Fielding your worst eleven every week has to cost you.
    expect(play(true)).toBeLessThan(play(false));
  });
});
