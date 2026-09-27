import { describe, expect, it } from 'vitest';
import { Rng } from '../rng/index.js';
import { allClubs, createWorld } from '../world/index.js';
import type { Club } from '../types.js';
import {
  applyCloseSeasonSpending,
  availableCapacity,
  crowdEffect,
  ECONOMY_TUNING,
  matchdayIncome,
} from '../economy/finances.js';
import {
  academyBoost,
  advanceGroundWorks,
  coachingFactor,
  expansionRoom,
  injuryLengthFactor,
  LEVER_TUNING,
  payWeeklyStaffCosts,
  recordStaffWeek,
  recoveryFactor,
  startGroundWorks,
} from '../economy/levers.js';
import { advancePlayerWeek } from '../world/status.js';
import { promoteYouth } from '../career/aging.js';
import {
  advanceRound,
  expandGround,
  managedClub,
  setStaffLevel,
  setTicketLevel,
  startCareer,
} from '../career/controller.js';
import { deserializeCareer, serializeCareer } from '../career/persistence.js';

function clubs(seed = 'levers'): Club[] {
  return allClubs(createWorld({ seed, divisions: 1 }));
}

describe('ticket price', () => {
  const [home, away] = clubs();

  it('charges and draws exactly what it always did at the normal price', () => {
    const E = ECONOMY_TUNING;
    const ppg = 1.6;
    const fill = Math.min(
      1,
      Math.max(
        0.35,
        E.baseFillFloor +
          ((home!.reputation - 40) / 100) * E.baseFillScale +
          (ppg - 1.3) * E.formFillWeight +
          ((away!.reputation - 60) / 100) * E.opponentFillWeight,
      ),
    );
    const attendance = Math.round(home!.finances.stadiumCapacity * fill);
    expect(matchdayIncome(home!, away!, ppg).attendance).toBe(attendance);
    expect(matchdayIncome(home!, away!, ppg).revenue).toBe(attendance * home!.finances.ticketPrice);
    expect(crowdEffect(home!, away!, ppg)).toBe(1);
  });

  it('earns less by charging more when the ground has seats to spare', () => {
    const normal = matchdayIncome(home!, away!, 0.5, 1);
    expect(normal.fill).toBeLessThan(1);
    expect(matchdayIncome(home!, away!, 0.5, 1.3).revenue).toBeLessThan(normal.revenue);
    expect(matchdayIncome(home!, away!, 0.5, 0.7).revenue).toBeLessThan(normal.revenue);
  });

  it('lets a sold-out ground charge more', () => {
    const giant = { ...home!, reputation: 95 };
    const minnow = { ...away!, reputation: 95 };
    const normal = matchdayIncome(giant, minnow, 2.6, 1);
    expect(normal.fill).toBe(1);
    expect(matchdayIncome(giant, minnow, 2.6, 1.2).revenue).toBeGreaterThan(normal.revenue);
  });

  it('turns a fuller ground into a bigger home advantage', () => {
    const cheap = { ...home!, finances: { ...home!.finances, ticketPriceLevel: 0.7 } };
    const dear = { ...home!, finances: { ...home!.finances, ticketPriceLevel: 1.5 } };
    expect(crowdEffect(cheap, away!, 0.5)).toBeGreaterThan(1);
    expect(crowdEffect(dear, away!, 0.5)).toBeLessThan(1);
  });

  it('snaps to the allowed range', () => {
    const career = startCareer({ seed: 'tickets', divisions: 1, cup: false });
    expect(setTicketLevel(career, 3)).toBe(LEVER_TUNING.ticketLevelMax);
    expect(setTicketLevel(career, 0.1)).toBe(LEVER_TUNING.ticketLevelMin);
    expect(setTicketLevel(career, 1.04)).toBe(1);
    expect(managedClub(career).finances.ticketPriceLevel).toBeUndefined();
  });
});

describe('staff', () => {
  it('costs more for elite, saves for basic, and nothing at standard', () => {
    const [a, b, c] = clubs('staff');
    b!.finances.staff = { medical: 1, coaching: 1, academy: 1 };
    c!.finances.staff = { medical: -1, coaching: -1, academy: -1 };
    expect(payWeeklyStaffCosts(a!, 20)).toBe(0);
    expect(payWeeklyStaffCosts(b!, 20)).toBeGreaterThan(0);
    expect(payWeeklyStaffCosts(c!, 20)).toBeLessThan(0);
  });

  it('speeds recovery and shortens injuries with better medical staff', () => {
    const [club] = clubs('medical');
    const player = club!.squad[0]!;
    player.status.condition = 50;
    advancePlayerWeek(player, 1);
    const standard = player.status.condition;

    player.status.condition = 50;
    club!.finances.staff = { medical: 1, coaching: 0, academy: 0 };
    advancePlayerWeek(player, recoveryFactor(club!));
    expect(player.status.condition).toBeGreaterThan(standard);
    expect(injuryLengthFactor(club!)).toBeLessThan(1);
  });

  it('judges coaching and the academy on the season, not the last week', () => {
    const [club] = clubs('average');
    for (let week = 0; week < 9; week++) recordStaffWeek(club!);
    club!.finances.staff = { medical: 0, coaching: 1, academy: 1 };
    recordStaffWeek(club!);

    expect(coachingFactor(club!)).toBeCloseTo(1 + LEVER_TUNING.coachingPerLevel / 10);
    expect(academyBoost(club!)).toBeCloseTo(LEVER_TUNING.academyPerLevel / 10);
  });

  it('turns out better academy graduates from an elite academy', () => {
    const [standard] = clubs('academy');
    const [elite] = clubs('academy');
    elite!.finances.staffWeeks = { coaching: 0, academy: 10, weeks: 10 };
    standard!.squad.length = 10;
    elite!.squad.length = 10;

    const worse = promoteYouth(new Rng('intake'), standard!, 16);
    const better = promoteYouth(new Rng('intake'), elite!, 16);
    const mean = (players: typeof worse) =>
      players.reduce((sum, p) => sum + p.hiddenPotential, 0) / players.length;
    expect(mean(better)).toBeGreaterThan(mean(worse));
  });
});

describe('the ground', () => {
  it('closes part of the ground while building, and opens the new seats after', () => {
    const [club] = clubs('ground');
    club!.finances.balance = 1e9;
    const before = club!.finances.stadiumCapacity;
    const seats = Math.min(2000, expansionRoom(club!));

    expect(startGroundWorks(club!, seats, true)).toEqual({
      ok: true,
      cost: seats * ECONOMY_TUNING.costPerSeat,
      weeks: LEVER_TUNING.groundWorksWeeks,
    });
    expect(availableCapacity(club!)).toBeLessThan(before);
    expect(startGroundWorks(club!, seats, true)).toEqual({ ok: false, reason: 'underway' });

    for (let week = 0; week < LEVER_TUNING.groundWorksWeeks; week++) advanceGroundWorks(club!);
    expect(club!.finances.groundWorks).toBeUndefined();
    expect(club!.finances.stadiumCapacity).toBe(before + seats);
    expect(availableCapacity(club!)).toBe(before + seats);
  });

  it('builds between seasons without closing anything', () => {
    const [club] = clubs('summer');
    club!.finances.balance = 1e9;
    const before = club!.finances.stadiumCapacity;
    expect(startGroundWorks(club!, 2000, false)).toMatchObject({ ok: true, weeks: 0 });
    expect(club!.finances.stadiumCapacity).toBe(before + 2000);
  });

  it('refuses what the club cannot afford or fit', () => {
    const [club] = clubs('refuse');
    club!.finances.balance = 0;
    expect(startGroundWorks(club!, 2000, true)).toEqual({ ok: false, reason: 'cannot_afford' });
    club!.finances.balance = 1e12;
    expect(startGroundWorks(club!, expansionRoom(club!) + 1, true)).toEqual({
      ok: false,
      reason: 'no_room',
    });
  });

  it('leaves the manager to decide: no automatic expansion', () => {
    const [auto] = clubs('auto');
    const [manual] = clubs('auto');
    for (const club of [auto!, manual!]) {
      club.finances.balance = 1e9;
      club.finances.season.gateReceipts =
        club.finances.stadiumCapacity * club.finances.ticketPrice * 19;
    }
    const before = manual!.finances.stadiumCapacity;
    applyCloseSeasonSpending(auto!, 20, 1, true);
    applyCloseSeasonSpending(manual!, 20, 1, false);
    expect(auto!.finances.stadiumCapacity).toBeGreaterThan(before);
    expect(manual!.finances.stadiumCapacity).toBe(before);
  });
});

describe('levers in a career', () => {
  it('keep their settings and building work across a save', () => {
    const career = startCareer({ seed: 'lever-save', divisions: 1, cup: false });
    managedClub(career).finances.balance = 1e9;
    setTicketLevel(career, 1.2);
    setStaffLevel(career, 'medical', 1);
    setStaffLevel(career, 'academy', -1);
    expect(expandGround(career, 2000)).toMatchObject({ ok: true });
    advanceRound(career);

    const restored = managedClub(deserializeCareer(serializeCareer(career)));
    expect(restored.finances.ticketPriceLevel).toBe(1.2);
    expect(restored.finances.staff).toEqual({ medical: 1, coaching: 0, academy: -1 });
    expect(restored.finances.groundWorks?.weeksLeft).toBe(LEVER_TUNING.groundWorksWeeks - 1);
    expect(restored.finances.staffWeeks?.weeks).toBe(1);
  });
});
