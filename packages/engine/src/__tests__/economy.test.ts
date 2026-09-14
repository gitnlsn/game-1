import { describe, expect, it } from 'vitest';
import { Rng } from '../rng/index.js';
import { createWorld } from '../world/index.js';
import { currentAbility, generatePlayer } from '../world/players.js';
import {
  contractMultiplier,
  expectedWage,
  formatMoney,
  marketValue,
  wageBill,
} from '../economy/valuation.js';
import {
  ECONOMY_TUNING,
  matchdayIncome,
  prizeMoney,
  stadiumCapacity,
} from '../economy/finances.js';

describe('marketValue', () => {
  const rng = new Rng('valuation');

  it('rises steeply with ability', () => {
    const make = (ability: number) =>
      generatePlayer(rng, { position: 'ST', potentialTarget: ability, age: 27 });

    const weak = marketValue(make(55));
    const good = marketValue(make(75));
    const elite = marketValue(make(88));

    expect(good).toBeGreaterThan(weak * 2);
    expect(elite).toBeGreaterThan(good * 2);
  });

  it('peaks in a player\'s early twenties and falls away with age', () => {
    // Ability is held fixed so this measures the age curve alone. Varying age
    // while holding *potential* fixed would not: an older player sits closer to
    // their potential, so they would be the better player as well as the older one.
    const base = generatePlayer(new Rng('age-value'), { position: 'CM', potentialTarget: 80, age: 26 });
    const at = (age: number) =>
      marketValue({ ...base, age, potential: 80, contract: { wage: 0, yearsRemaining: 3 } });

    expect(at(23)).toBeGreaterThan(at(18));
    expect(at(23)).toBeGreaterThan(at(30));
    expect(at(30)).toBeGreaterThan(at(35));
    expect(at(35)).toBeGreaterThan(0);
  });

  it('discounts a player running down their contract', () => {
    const player = generatePlayer(rng, { position: 'CB', potentialTarget: 78, age: 27 });
    player.contract.yearsRemaining = 4;
    const long = marketValue(player);
    player.contract.yearsRemaining = 0;
    const expiring = marketValue(player);

    expect(expiring).toBeLessThan(long * 0.5);
    expect(contractMultiplier(0)).toBeLessThan(contractMultiplier(3));
  });

  it('keeps wages well below value, and compressed relative to it', () => {
    const modest = generatePlayer(new Rng('w1'), { position: 'ST', potentialTarget: 62, age: 26 });
    const star = generatePlayer(new Rng('w2'), { position: 'ST', potentialTarget: 88, age: 26 });

    const annual = (p: typeof modest) => expectedWage(p) * ECONOMY_TUNING.wageWeeksPerSeason;
    // A year's wages should be a fraction of what the player is worth.
    expect(annual(star)).toBeLessThan(marketValue(star));
    // Wages spread less than values do.
    const valueRatio = marketValue(star) / marketValue(modest);
    const wageRatio = expectedWage(star) / expectedWage(modest);
    expect(wageRatio).toBeLessThan(valueRatio);
    expect(wageRatio).toBeGreaterThan(1);
  });
});

describe('formatMoney', () => {
  it('renders readable magnitudes', () => {
    expect(formatMoney(12_400_000)).toBe('12.4M');
    expect(formatMoney(950_000)).toBe('950K');
    expect(formatMoney(-2_000_000)).toBe('-2.0M');
    expect(formatMoney(450)).toBe('450');
  });
});

describe('club finances', () => {
  it('sizes stadiums and prize money by standing', () => {
    expect(stadiumCapacity(80)).toBeGreaterThan(stadiumCapacity(55));
    expect(prizeMoney(1, 20)).toBeGreaterThan(prizeMoney(20, 20));
    // Even last place gets the equal broadcast share.
    expect(prizeMoney(20, 20)).toBeGreaterThanOrEqual(ECONOMY_TUNING.tvEqualShare);
  });

  it('never sells more tickets than the ground holds', () => {
    const world = createWorld({ seed: 'gate' });
    const [home, away] = world.league.clubs;

    for (const form of [0, 1.3, 3]) {
      const { attendance, revenue } = matchdayIncome(home!, away!, form);
      expect(attendance).toBeLessThanOrEqual(home!.finances.stadiumCapacity);
      expect(attendance).toBeGreaterThan(0);
      expect(revenue).toBe(attendance * home!.finances.ticketPrice);
    }
  });

  it('draws a bigger crowd when the season is going well', () => {
    const world = createWorld({ seed: 'gate-form' });
    const [home, away] = world.league.clubs;
    const poor = matchdayIncome(home!, away!, 0.5).attendance;
    const strong = matchdayIncome(home!, away!, 2.5).attendance;
    expect(strong).toBeGreaterThan(poor);
  });

  it('gives every club a wage bill it can plausibly carry', () => {
    const world = createWorld({ seed: 'wages' });
    for (const club of world.league.clubs) {
      const annual = wageBill(club.squad) * ECONOMY_TUNING.wageWeeksPerSeason;
      expect(annual).toBeGreaterThan(0);
      // Nobody should start the game already ruined.
      expect(club.finances.balance).toBeGreaterThan(0);
    }
  });

  it('starts every club inside its own wage budget', () => {
    // Squads and budgets are generated independently, so without an explicit fit
    // a third of clubs begin the game over budget and a few above their revenue.
    for (const seed of ['fit-a', 'fit-b', 'fit-c']) {
      for (const club of createWorld({ seed }).league.clubs) {
        expect(wageBill(club.squad), `${club.name} wage bill`).toBeLessThanOrEqual(
          club.finances.wageBudget,
        );
      }
    }
  });

  it('pays better players more', () => {
    const world = createWorld({ seed: 'wage-order' });
    const squad = [...world.league.clubs[0]!.squad].sort((a, b) => currentAbility(b) - currentAbility(a));
    const best = squad[0]!;
    const worst = squad[squad.length - 1]!;
    expect(best.contract.wage).toBeGreaterThan(worst.contract.wage);
  });
});
