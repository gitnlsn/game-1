import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  answerOffer,
  bidFor,
  browseTargets,
  deserializeCareer,
  endSeason,
  incomingOffers,
  isMidSeasonWindow,
  isSeasonComplete,
  managedClub,
  MID_SEASON_WINDOW,
  serializeCareer,
  startCareer,
  startNextSeason,
  transferWindow,
  type Career,
} from '../career/index.js';

/** Plays rounds until the mid-season window opens; the round it opened after. */
function playToWindow(career: Career): number {
  let guard = 0;
  while (!transferWindow(career) && guard++ < 100) advanceRound(career);
  return career.season.nextRound - 1;
}

describe('mid-season window', () => {
  it('opens halfway through, runs alongside the matches, and shuts by itself', () => {
    const career = startCareer({ seed: 'mid-open', managedClubId: 'c5' });
    const openedAfter = playToWindow(career);
    const window = transferWindow(career)!;

    expect(isMidSeasonWindow(career)).toBe(true);
    expect(openedAfter).toBe(Math.ceil(career.season.totalRounds * MID_SEASON_WINDOW.opensAt));
    expect(window.closesBeforeRound).toBe(openedAfter + 1 + MID_SEASON_WINDOW.matchdays);

    // Matches go on while it is open.
    for (let i = 0; i < MID_SEASON_WINDOW.matchdays; i++) {
      expect(transferWindow(career)).toBeDefined();
      advanceRound(career);
    }
    // The next round shuts it before a ball is kicked.
    advanceRound(career);
    expect(transferWindow(career)).toBeUndefined();
    expect(career.world.transferWindow?.open).toBe(false);
  });

  it('lets the manager buy while it is open, and not once it has shut', () => {
    const career = startCareer({ seed: 'mid-buy', managedClubId: 'c2' });
    playToWindow(career);
    const target = browseTargets(career).find((l) => l.askingPrice > 0 && l.affordable);
    expect(target).toBeDefined();

    const outcome = bidFor(career, target!.player.id, target!.askingPrice);
    expect(outcome.accepted).toBe(true);
    expect(managedClub(career).squad.some((p) => p.id === target!.player.id)).toBe(true);

    let guard = 0;
    while (transferWindow(career) && guard++ < 10) advanceRound(career);
    const later = browseTargets(career)[0];
    if (later) expect(bidFor(career, later.player.id, later.askingPrice).accepted).toBe(false);
  });

  it('opens once a season, and its business lands in that season’s summary', () => {
    const career = startCareer({ seed: 'mid-once', managedClubId: 'c4' });
    playToWindow(career);
    // Turn down whatever came in, so only the AI's business is counted.
    for (const offer of incomingOffers(career)) answerOffer(career, offer.id, 'reject');
    let opened = 1;
    let wasOpen = true;
    let guard = 0;
    while (!isSeasonComplete(career) && guard++ < 100) {
      advanceRound(career);
      const open = transferWindow(career) !== undefined;
      if (open && !wasOpen) opened += 1;
      wasOpen = open;
    }
    expect(opened).toBe(1);

    const midSeason = career.world.transferWindow!;
    expect(midSeason.midSeason).toBe(true);
    const midCount = midSeason.completed.length;
    expect(midCount).toBeGreaterThan(0);

    const summary = endSeason(career);
    expect(summary.transfers.length).toBeGreaterThanOrEqual(midCount);
    expect(transferWindow(career)?.midSeason).toBeUndefined();
    startNextSeason(career);
    // And again the next season.
    playToWindow(career);
    expect(isMidSeasonWindow(career)).toBe(true);
  });

  it('is gentler than the close season: at most one AI signing per club', () => {
    const career = startCareer({ seed: 'mid-gentle', managedClubId: 'c1' });
    playToWindow(career);
    const before = career.world.transferWindow!.completed.length;
    let guard = 0;
    while (transferWindow(career) && guard++ < 10) advanceRound(career);
    const shopping = career.world.transferWindow!.completed.slice(before);
    const perBuyer = new Map<string, number>();
    for (const t of shopping) perBuyer.set(t.toClubId, (perBuyer.get(t.toClubId) ?? 0) + 1);
    for (const count of perBuyer.values()) expect(count).toBeLessThanOrEqual(MID_SEASON_WINDOW.maxSignings);
  });

  it('survives a save while open', () => {
    const career = startCareer({ seed: 'mid-save', managedClubId: 'c3' });
    playToWindow(career);
    const loaded = deserializeCareer(serializeCareer(career));
    expect(isMidSeasonWindow(loaded)).toBe(true);
    expect(transferWindow(loaded)!.closesBeforeRound).toBe(transferWindow(career)!.closesBeforeRound);
  });

  it('cannot start the next season while the mid-season window is open', () => {
    const career = startCareer({ seed: 'mid-guard', managedClubId: 'c3' });
    playToWindow(career);
    expect(() => startNextSeason(career)).toThrow();
  });
});

describe('the managed club only buys what its manager chose', () => {
  it('is never sold a player by a club in distress, in either window', () => {
    for (const managedClubId of ['c1', 'c2', 'c3', 'c6']) {
      const career = startCareer({ seed: `insulated-${managedClubId}`, managedClubId });
      const arrivals: string[] = [];
      for (let season = 0; season < 2; season++) {
        let guard = 0;
        while (!isSeasonComplete(career) && guard++ < 100) {
          advanceRound(career);
          for (const t of career.world.transferWindow?.completed ?? []) {
            if (t.toClubId === managedClubId) arrivals.push(t.playerName);
          }
        }
        const summary = endSeason(career);
        for (const t of summary.transfers) if (t.toClubId === managedClubId) arrivals.push(t.playerName);
        for (const t of startNextSeason(career)) if (t.toClubId === managedClubId) arrivals.push(t.playerName);
      }
      expect(arrivals).toEqual([]);
    }
  });
});
