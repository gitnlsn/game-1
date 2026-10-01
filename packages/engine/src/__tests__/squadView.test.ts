import { describe, expect, it } from 'vitest';
import {
  managedClub,
  pruneManagerState,
  scoutReport,
  startCareer,
  type Career,
} from '../career/controller.js';
import { squadAlerts, squadDepth, squadMembers } from '../career/squadView.js';
import {
  isShortlisted,
  searchMarket,
  shortlistRows,
  toggleShortlist,
} from '../career/manager.js';
import { deserializeCareer, serializeCareer } from '../career/persistence.js';
import { allClubs } from '../world/index.js';
import { currentAbility } from '../world/players.js';

function career(seed: string): Career {
  return startCareer({ seed, divisions: 1, cup: false });
}

function otherPlayer(c: Career) {
  const club = allClubs(c.world).find((x) => x.id !== c.managedClubId)!;
  return club.squad[0]!;
}

describe('squad roles', () => {
  it('gives every player exactly one role, with eleven key men', () => {
    const c = career('roles');
    const members = squadMembers(c);

    expect(members.length).toBe(managedClub(c).squad.length);
    expect(members.filter((m) => m.role === 'key').length).toBe(11);
  });

  it('flags the last year of a contract independently of role', () => {
    const c = career('expiring');
    const player = managedClub(c).squad[0]!;
    player.contract.yearsRemaining = 1;

    const member = squadMembers(c).find((m) => m.player.id === player.id)!;
    expect(member.expiring).toBe(true);
  });

  it('calls a player a prospect only when the scouted band says so', () => {
    for (const seed of ['prospects-a', 'prospects-b', 'prospects-c']) {
      const c = career(seed);
      for (const m of squadMembers(c)) {
        if (m.role !== 'prospect') continue;
        expect(m.player.age).toBeLessThanOrEqual(21);
        expect(scoutReport(c, m.player).low).toBeGreaterThan(currentAbility(m.player) + 6);
      }
    }
  });

  it('counts depth per part of the pitch', () => {
    const c = career('depth');
    const depth = squadDepth(c);
    expect(depth.map((d) => d.group)).toEqual(['GK', 'DEF', 'MID', 'FWD']);
    expect(depth.reduce((sum, d) => sum + d.have, 0)).toBe(managedClub(c).squad.length);
    expect(depth.find((d) => d.group === 'GK')!.starting).toBe(1);
  });

  it('raises an alert for an expiring first-choice player', () => {
    const c = career('alerts');
    const key = squadMembers(c).find((m) => m.role === 'key')!.player;
    key.contract.yearsRemaining = 1;

    expect(squadAlerts(c).some((a) => a.kind === 'expiring_key' && a.playerId === key.id)).toBe(true);
  });
});

describe('the shortlist', () => {
  it('adds and removes a player from another club', () => {
    const c = career('shortlist');
    const target = otherPlayer(c);

    expect(toggleShortlist(c, target.id)).toBe(true);
    expect(isShortlisted(c, target.id)).toBe(true);
    expect(shortlistRows(c)[0]!.listing.player.id).toBe(target.id);

    expect(toggleShortlist(c, target.id)).toBe(false);
    expect(shortlistRows(c)).toHaveLength(0);
  });

  it('will not take your own players', () => {
    const c = career('shortlist-own');
    expect(toggleShortlist(c, managedClub(c).squad[0]!.id)).toBe(false);
    expect(c.shortlist).toHaveLength(0);
  });

  it('drops players who have left the game', () => {
    const c = career('shortlist-prune');
    const target = otherPlayer(c);
    toggleShortlist(c, target.id);
    c.world.players.delete(target.id);

    pruneManagerState(c);
    expect(c.shortlist).toHaveLength(0);
  });

  it('survives a save', () => {
    const c = career('shortlist-save');
    const target = otherPlayer(c);
    toggleShortlist(c, target.id);

    const loaded = deserializeCareer(serializeCareer(c));
    expect(isShortlisted(loaded, target.id)).toBe(true);
  });
});

describe('searching the market', () => {
  it('filters on the scouted band and on age and wages', () => {
    const c = career('search');
    const results = searchMarket(c, { minPotential: 70, minAge: 18, maxAge: 23, maxWage: 50_000 });

    for (const listing of results) {
      expect(scoutReport(c, listing.player).high).toBeGreaterThanOrEqual(70);
      expect(listing.player.age).toBeGreaterThanOrEqual(18);
      expect(listing.player.age).toBeLessThanOrEqual(23);
      expect(listing.expectedWage).toBeLessThanOrEqual(50_000);
    }
  });

  it('applies the limit after filtering', () => {
    const c = career('search-limit');
    expect(searchMarket(c, { minPotential: 0, limit: 5 })).toHaveLength(5);
  });
});

describe('save version 10', () => {
  it('upgrades a v9 save with nothing planned or watched', () => {
    const c = career('v9');
    const saved = JSON.parse(serializeCareer(c));
    for (const key of ['shortlist', 'listings', 'training', 'progression']) delete saved[key];
    saved.version = 9;

    const loaded = deserializeCareer(JSON.stringify(saved));
    expect(loaded.shortlist).toEqual([]);
    expect(loaded.listings).toEqual({});
    expect(loaded.training).toEqual({});
    expect(loaded.progression).toEqual({});
  });
});
