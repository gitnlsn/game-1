import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  endSeason,
  isSeasonComplete,
  managedClub,
  startCareer,
  type Career,
} from '../career/controller.js';
import { confirmPlan, movePlayerId, plannedMoves, planMove, planPreview } from '../career/plan.js';
import { assistantPlan, draftAssistantPlan } from '../career/assistant.js';
import { departureImpact, squadMembers } from '../career/squadView.js';
import { effectiveWageBill } from '../transfers/loans.js';
import { TRANSFER_TUNING } from '../transfers/market.js';

function toWindow(seed: string, rich = true): Career {
  const career = startCareer({ seed, divisions: 1, cup: false });
  let guard = 0;
  while (!isSeasonComplete(career) && guard++ < 80) advanceRound(career);
  endSeason(career);
  if (rich) {
    const finances = managedClub(career).finances;
    finances.transferBudget += 50_000_000;
    finances.wageBudget += 500_000;
  }
  return career;
}

const SEEDS = ['assistant-a', 'assistant-b'];

describe('the assistant', () => {
  it('suggests without changing anything', () => {
    const c = toWindow('assistant-pure');
    const squad = managedClub(c).squad.map((p) => p.id);

    const plan = assistantPlan(c);
    expect(plan.moves.length).toBeGreaterThan(0);
    expect(plannedMoves(c)).toHaveLength(0);
    expect(managedClub(c).squad.map((p) => p.id)).toEqual(squad);
  });

  it('drafts a plan that stays inside the budget, the wages and the squad limits', () => {
    for (const seed of SEEDS) {
      const c = toWindow(seed);
      draftAssistantPlan(c);
      const preview = planPreview(c);

      const kinds = preview.warnings.map((w) => w.kind);
      expect(kinds, seed).not.toContain('over_budget');
      expect(kinds, seed).not.toContain('over_wages');
      expect(kinds, seed).not.toContain('no_goalkeeper');
      expect(preview.after.squadSize).toBeGreaterThanOrEqual(TRANSFER_TUNING.minSquadSize);
      expect(preview.after.squadSize).toBeLessThanOrEqual(TRANSFER_TUNING.maxSquadSize);
    }
  });

  it('gives every move a reason and moves each player out at most once', () => {
    const c = toWindow('assistant-reasons');
    draftAssistantPlan(c);
    const moves = plannedMoves(c);

    expect(moves.every((m) => (m.reason ?? '').length > 0)).toBe(true);
    const out = moves
      .filter((m) => m.kind === 'sell' || m.kind === 'release' || m.kind === 'loanOut')
      .map((m) => movePlayerId(c, m));
    expect(new Set(out).size).toBe(out.length);
  });

  it('never sells or releases a first-choice player the side would miss', () => {
    for (const seed of SEEDS) {
      const c = toWindow(seed);
      const key = new Map(
        squadMembers(c)
          .filter((m) => m.role === 'key')
          .map((m) => [m.player.id, departureImpact(c, m.player).drop] as const),
      );
      const moves = assistantPlan(c).moves;
      // A starter sold because a signing in the same plan takes his place is
      // not missed: the drop is measured against today's squad, without him.
      const signedAt = new Set(
        moves.flatMap((m) => (m.kind === 'buy' ? [c.world.players.get(m.playerId)!.position] : [])),
      );
      for (const move of moves) {
        if (move.kind !== 'sell' && move.kind !== 'release') continue;
        const id = movePlayerId(c, move as never)!;
        if (move.kind === 'sell' && signedAt.has(c.world.players.get(id)!.position)) continue;
        if (key.has(id)) expect(key.get(id)!, seed).toBeLessThanOrEqual(3);
      }
    }
  });

  it('drafts moves that go through when confirmed', () => {
    // The many-* careers once failed here: a loan below the squad floor once
    // every departure was made, and a renewal for a player already sent on loan.
    for (const seed of [...SEEDS, 'many-0', 'many-4', 'many-6']) {
      const c = toWindow(seed, false);
      const finances = managedClub(c).finances;
      finances.transferBudget += 30_000_000;
      finances.wageBudget += 300_000;
      draftAssistantPlan(c);
      const results = confirmPlan(c);
      const failed = results.filter((r) => !r.ok).map((r) => `${r.move.kind}: ${r.reason}`);
      expect(failed, seed).toEqual([]);
    }
  });

  it('never loans out a player in his last year, since he could not then be renewed', () => {
    for (const seed of SEEDS) {
      const c = toWindow(seed);
      for (const move of assistantPlan(c).moves) {
        if (move.kind !== 'loanOut') continue;
        expect(c.world.players.get(move.playerId)!.contract.yearsRemaining).toBeGreaterThan(1);
      }
    }
  });

  it('keeps the moves the manager already planned', () => {
    const c = toWindow('assistant-keeps');
    const mine = squadMembers(c).find((m) => m.role === 'key')!.player;
    planMove(c, { kind: 'renew', playerId: mine.id, wage: mine.contract.wage * 2, years: 2 });

    draftAssistantPlan(c);
    const forHim = plannedMoves(c).filter((m) => movePlayerId(c, m) === mine.id);
    expect(forHim).toHaveLength(1);
    expect(forHim[0]!.reason).toBeUndefined();
  });

  it('over the wage budget, frees wages and signs nobody it cannot pay', () => {
    const c = toWindow('assistant-broke', false);
    const club = managedClub(c);
    club.finances.wageBudget = effectiveWageBill(c.world, club) - 200_000;

    const plan = draftAssistantPlan(c);
    expect(planPreview(c).warnings.map((w) => w.kind)).not.toContain('over_wages');
    // Whatever it could not afford, it says, rather than leaving it out silently.
    if (!plan.moves.some((m) => m.kind === 'buy')) {
      expect(plan.notes.length).toBeGreaterThan(0);
    }
  });
});
