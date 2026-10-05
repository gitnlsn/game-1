import { describe, expect, it } from 'vitest';
import {
  managedClub,
  pruneManagerState,
  scoutReport,
  startCareer,
  type Career,
} from '../career/controller.js';
import {
  departureImpact,
  sideComparer,
  squadAlerts,
  squadDepth,
  squadMembers,
} from '../career/squadView.js';
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
    let prospects = 0;
    for (const seed of ['prospects-a', 'prospects-b', 'prospects-c']) {
      const c = career(seed);
      for (const m of squadMembers(c)) {
        const report = scoutReport(c, m.player);
        const qualifies =
          m.player.age <= 21 && report.low > currentAbility(m.player) + 6 && m.role !== 'key';
        // Both ways: every prospect qualifies, and every qualifying non-starter is one.
        expect(m.role === 'prospect', m.player.displayName).toBe(qualifies);
        if (qualifies) prospects++;
      }
    }
    expect(prospects).toBeGreaterThan(0);
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

    const group = squadAlerts(c).find((a) => a.kind === 'expiring_key');
    expect(group?.players.map((p) => p.id)).toContain(key.id);
    // One group however many players it covers.
    expect(squadAlerts(c).filter((a) => a.kind === 'expiring_key')).toHaveLength(1);
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

describe('comparing with your side', () => {
  it('measures a target against a starter in his position, with a verdict to match', () => {
    const c = career('compare');
    const compare = sideComparer(c);
    const key = new Set(squadMembers(c).filter((m) => m.role === 'key').map((m) => m.player.id));
    const others = allClubs(c.world).filter((x) => x.id !== c.managedClubId).flatMap((x) => x.squad);

    for (const player of others.slice(0, 60)) {
      const result = compare(player);
      expect(result.difference).toBeCloseTo(result.rating - result.rivalRating);
      if (result.verdict === 'no_slot') continue;
      expect(key.has(result.rival!.id)).toBe(true);
      expect(result.verdict).toBe(
        result.difference > 2.5 ? 'upgrade' : result.difference < -2.5 ? 'backup' : 'level',
      );
    }
  });

  it('calls a copy of your own starter level with him', () => {
    const c = career('compare-copy');
    const starter = squadMembers(c).find((m) => m.role === 'key' && m.player.position !== 'GK')!.player;
    const twin = { ...starter, id: 'twin' };

    const result = sideComparer(c)(twin);
    // Level with the weakest starter there, who may be the original or a weaker partner.
    expect(['level', 'upgrade']).toContain(result.verdict);
    expect(result.difference).toBeGreaterThanOrEqual(-0.001);
  });

  it('says a player outside the eleven costs the side nothing', () => {
    const c = career('impact-bench');
    const members = squadMembers(c);
    const bench = members.find((m) => m.role !== 'key' && m.player.position === 'GK')!.player;
    const keeper = members.find((m) => m.role === 'key' && m.player.position === 'GK')!.player;
    expect(departureImpact(c, bench)).toMatchObject({ starts: false, drop: 0, behind: keeper });
  });

  it('names who comes into the eleven when a starter goes', () => {
    const c = career('impact-starter');
    const members = squadMembers(c);
    const key = new Set(members.filter((m) => m.role === 'key').map((m) => m.player.id));

    for (const m of members.filter((x) => x.role === 'key')) {
      const impact = departureImpact(c, m.player);
      expect(impact.starts).toBe(true);
      expect(impact.drop).toBeGreaterThanOrEqual(0);
      if (impact.replacement) expect(key.has(impact.replacement.id)).toBe(false);
    }
  });

  it('feels the loss of the only goalkeeper hardest', () => {
    const c = career('impact-keeper');
    const club = managedClub(c);
    const first = squadMembers(c).find((m) => m.role === 'key' && m.player.position === 'GK')!.player;
    club.squad = club.squad.filter((p) => p.position !== 'GK' || p.id === first.id);

    const outfield = squadMembers(c).find((m) => m.role === 'key' && m.player.position !== 'GK')!.player;
    expect(departureImpact(c, first).drop).toBeGreaterThan(departureImpact(c, outfield).drop);
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
