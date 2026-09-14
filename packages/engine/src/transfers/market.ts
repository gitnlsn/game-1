import { Rng } from '../rng/index.js';
import type { Club, Player, Position, Transfer, World } from '../types.js';
import { expectedWage, marketValue, wageBill } from '../economy/valuation.js';
import { abilityIn, positionFamiliarity } from '../world/positions.js';
import { bestAbilityAt, depthAt, squadNeeds, targetAbility } from './needs.js';
import { abilityIn as ability } from '../world/positions.js';

export const TRANSFER_TUNING = {
  /**
   * Squad sizes the market will not push a club outside of. The selling floor is
   * deliberately below the size clubs restock to: if they coincide, every club
   * sits on the floor and no club can ever sell anyone.
   */
  minSquadSize: 20,
  targetSquadSize: 25,
  maxSquadSize: 30,
  /** Signings one club can make in a single window. */
  maxSigningsPerWindow: 4,
  /** How many of its weakest positions a club will try to strengthen. */
  positionsShoppedPerWindow: 6,
  /**
   * Most a club will pay above market value. This must exceed keyPlayerPremium,
   * or a selling club's best players are literally unbuyable at any price and
   * rich clubs have nothing to spend their money on.
   */
  maxFeePremium: 2.5,
  /** Asking-price premium by how important the player is to the selling club. */
  keyPlayerPremium: 2.1,
  starterPremium: 1.5,
  squadPlayerPremium: 1.15,
  /** A signing must beat what the club already has by this much to be worth it. */
  improvementThreshold: 2,
  /** Raise a player expects to change clubs. */
  moveWageMin: 1.05,
  moveWageMax: 1.35,
  /** A club will not commit more than this share of its wage budget. */
  wageBudgetCeiling: 1,
  /** Reputation drop a player will tolerate before needing to be paid extra. */
  reputationTolerance: 8,
  /** Discount a club in debt has to accept to shift a player quickly. */
  distressDiscount: 0.85,
  /** Players one club will sell to clear a deficit in a single window. */
  maxDistressSales: 3,
  /** Contracts a club will tear up when nobody will buy. */
  maxDistressReleases: 3,
} as const;

interface MarketPlayer {
  player: Player;
  club: Club | undefined; // undefined = free agent
}

/**
 * Runs one close-season transfer window. Clubs are processed in a shuffled order
 * so no club gets a permanent first-pick advantage, and each works down its own
 * list of squad needs.
 */
export function runTransferWindow(rng: Rng, world: World): Transfer[] {
  const T = TRANSFER_TUNING;
  const transfers: Transfer[] = [];
  const clubs = world.league.clubs;

  // Clubs clear out the players they do not need before shopping. This frees
  // wage room to sign anyone, and stocks the free-agent market for everyone else.
  for (const club of clubs) trimSquad(world, club);

  // Clubs in the red sell to balance the books before anyone goes shopping.
  for (const club of clubs) transfers.push(...raiseFunds(rng, world, club));

  for (const club of rng.shuffle(clubs)) {
    let signings = 0;

    // Work down the weakest positions. Clubs shop to improve, not only when they
    // have fallen below the standard their reputation implies -- a strong club
    // with money in the bank still wants a better left back.
    for (const need of squadNeeds(club).slice(0, T.positionsShoppedPerWindow)) {
      if (signings >= T.maxSigningsPerWindow) break;
      if (club.squad.length >= T.maxSquadSize) break;

      const candidate = findBestCandidate(rng, world, club, need.position, need.current);
      if (!candidate) continue;

      const transfer = attemptTransfer(rng, world, club, candidate);
      if (!transfer) continue;

      transfers.push(transfer);
      signings++;
    }
  }

  return transfers;
}

/**
 * Best realistic target for a position: the highest-ability player the club can
 * afford, who improves them, and who would actually come.
 */
function findBestCandidate(
  rng: Rng,
  world: World,
  buyer: Club,
  position: Position,
  currentQuality: number,
): MarketPlayer | undefined {
  const T = TRANSFER_TUNING;
  const pool: MarketPlayer[] = world.freeAgents.map((player) => ({ player, club: undefined }));

  for (const club of world.league.clubs) {
    if (club.id === buyer.id) continue;
    for (const player of club.squad) pool.push({ player, club });
  }

  let best: MarketPlayer | undefined;
  let bestScore = -Infinity;

  for (const entry of pool) {
    const { player, club: seller } = entry;
    const ability = abilityIn(player.attributes, position) * positionFamiliarity(player.position, position);
    if (ability < currentQuality + T.improvementThreshold) continue;

    if (seller) {
      if (seller.squad.length <= T.minSquadSize) continue;
      // A club will not sell its only specialist in a position.
      if (depthAt(seller, player.position) <= 1) continue;
    }

    if (!playerWouldJoin(player, seller, buyer)) continue;
    if (!buyerCanAfford(buyer, player, seller)) continue;

    // Prefer the biggest upgrade, with a nudge toward younger players.
    const score = ability + Math.max(0, 27 - player.age) * 0.35 + rng.float(0, 1.5);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return best;
}

/**
 * A club in debt sells its way out. It offers its most valuable saleable player
 * to whoever can pay, at a discount, and keeps going until it is solvent or out
 * of players it can spare.
 *
 * This is the main mechanism that stops badly-run clubs spiralling, and it moves
 * talent from clubs that cannot afford it to clubs that can -- which is exactly
 * what happens in real leagues.
 */
function raiseFunds(rng: Rng, world: World, seller: Club): Transfer[] {
  const T = TRANSFER_TUNING;
  const sales: Transfer[] = [];
  let releases = 0;

  while (
    seller.finances.balance < 0 &&
    sales.length < T.maxDistressSales &&
    releases < T.maxDistressReleases &&
    seller.squad.length > T.minSquadSize
  ) {
    const saleable = seller.squad
      .filter((player) => depthAt(seller, player.position) > 1)
      .sort((a, b) => marketValue(b) - marketValue(a));

    let sold = false;
    for (const player of saleable) {
      const price = Math.round(askingPrice(seller, player) * T.distressDiscount);
      const buyer = findBuyer(world, seller, player, price);
      if (!buyer) continue;

      seller.squad = seller.squad.filter((p) => p.id !== player.id);
      seller.finances.balance += price;
      seller.finances.season.playerSales += price;
      buyer.finances.balance -= price;
      buyer.finances.transferBudget -= price;
      buyer.finances.season.playerPurchases += price;

      const wage = Math.round(expectedWage(player) * rng.float(T.moveWageMin, T.moveWageMax));
      player.contract = { wage, yearsRemaining: rng.int(2, 5) };
      buyer.squad.push(player);

      sales.push({
        playerId: player.id,
        playerName: player.displayName,
        fromClubId: seller.id,
        toClubId: buyer.id,
        fee: price,
        wage,
        free: false,
      });
      sold = true;
      break;
    }

    // Nobody wants them at any price, but the wages still have to be paid. The
    // club tears up the biggest contract it can spare. Without this a club whose
    // squad is worth nothing can never escape debt, and spirals forever.
    if (!sold) {
      const releasable = seller.squad
        .filter((player) => depthAt(seller, player.position) > 1)
        .sort((a, b) => b.contract.wage - a.contract.wage);

      const release = releasable[0];
      if (!release) break;

      seller.squad = seller.squad.filter((p) => p.id !== release.id);
      world.freeAgents.push(release);
      releases++;
      if (releases >= T.maxDistressReleases) break;
    }
  }

  return sales;
}

/** The club best placed to take a player off a struggling club's hands. */
function findBuyer(world: World, seller: Club, player: Player, price: number): Club | undefined {
  const T = TRANSFER_TUNING;
  let best: Club | undefined;

  for (const buyer of world.league.clubs) {
    if (buyer.id === seller.id) continue;
    if (buyer.squad.length >= T.maxSquadSize) continue;
    if (buyer.finances.transferBudget < price) continue;
    if (!playerWouldJoin(player, seller, buyer)) continue;

    const wage = expectedWage(player) * T.moveWageMax;
    if (wageBill(buyer.squad) + wage > buyer.finances.wageBudget * T.wageBudgetCeiling) continue;

    // Only worth buying if the player would actually improve them.
    const quality = ability(player.attributes, player.position);
    if (quality < bestAbilityAt(buyer, player.position) - 1) continue;

    if (!best || buyer.finances.transferBudget > best.finances.transferBudget) best = buyer;
  }

  return best;
}

/**
 * Releases players a club has no use for: the weakest members of an oversized
 * squad who are past developing. They become free agents, which is how smaller
 * clubs restock without paying fees.
 */
function trimSquad(world: World, club: Club): void {
  const T = TRANSFER_TUNING;
  if (club.squad.length <= T.targetSquadSize) return;

  const ranked = [...club.squad].sort(
    (a, b) => ability(a.attributes, a.position) - ability(b.attributes, b.position),
  );

  for (const player of ranked) {
    if (club.squad.length <= T.targetSquadSize) break;
    // Keep young players: they are the club's future, not deadweight.
    if (player.age <= 21) continue;
    if (depthAt(club, player.position) <= 1) continue;

    club.squad = club.squad.filter((p) => p.id !== player.id);
    world.freeAgents.push(player);
  }
}

/** Players do not drop far down the pyramid unless they are not playing. */
function playerWouldJoin(player: Player, seller: Club | undefined, buyer: Club): boolean {
  const T = TRANSFER_TUNING;
  if (!seller) return true; // A free agent takes what they can get.

  const reputationDrop = seller.reputation - buyer.reputation;
  if (reputationDrop <= T.reputationTolerance) return true;

  // A player who is not in the XI will move down a level for regular football.
  const ability = abilityIn(player.attributes, player.position);
  const isStarter = ability >= bestAbilityAt(seller, player.position, player.id);
  return !isStarter;
}

function buyerCanAfford(buyer: Club, player: Player, seller: Club | undefined): boolean {
  const T = TRANSFER_TUNING;
  const wage = expectedWage(player) * T.moveWageMax;
  if (wageBill(buyer.squad) + wage > buyer.finances.wageBudget * T.wageBudgetCeiling) return false;
  if (!seller) return true;
  return buyer.finances.transferBudget >= askingPrice(seller, player);
}

/** What the selling club wants, driven by how much they need the player. */
export function askingPrice(seller: Club, player: Player): number {
  const T = TRANSFER_TUNING;
  const value = marketValue(player);
  const ability = abilityIn(player.attributes, player.position);
  const isStarter = ability >= bestAbilityAt(seller, player.position, player.id);

  if (!isStarter) return Math.round(value * T.squadPlayerPremium);

  const isKey = ability >= targetAbility(seller.reputation);
  return Math.round(value * (isKey ? T.keyPlayerPremium : T.starterPremium));
}

function attemptTransfer(
  rng: Rng,
  world: World,
  buyer: Club,
  candidate: MarketPlayer,
): Transfer | undefined {
  const T = TRANSFER_TUNING;
  const { player, club: seller } = candidate;

  let fee = 0;
  if (seller) {
    const price = askingPrice(seller, player);
    const maxBid = Math.min(buyer.finances.transferBudget, marketValue(player) * T.maxFeePremium);
    if (maxBid < price) return undefined;
    fee = Math.round(price);

    // Money moves.
    seller.squad = seller.squad.filter((p) => p.id !== player.id);
    seller.finances.balance += fee;
    seller.finances.season.playerSales += fee;
    buyer.finances.balance -= fee;
    buyer.finances.transferBudget -= fee;
    buyer.finances.season.playerPurchases += fee;
  } else {
    world.freeAgents = world.freeAgents.filter((p) => p.id !== player.id);
  }

  const wage = Math.round(expectedWage(player) * rng.float(T.moveWageMin, T.moveWageMax));
  player.contract = { wage, yearsRemaining: rng.int(2, 5) };
  buyer.squad.push(player);

  return {
    playerId: player.id,
    playerName: player.displayName,
    fromClubId: seller?.id ?? '',
    toClubId: buyer.id,
    fee,
    wage,
    free: seller === undefined,
  };
}

/**
 * Contract renewals and expiries, run before the window opens. Clubs keep the
 * players they rate and can afford; everyone else becomes a free agent.
 */
export function processContracts(rng: Rng, world: World): { renewed: number; released: Player[] } {
  const T = TRANSFER_TUNING;
  const released: Player[] = [];
  let renewed = 0;

  for (const club of world.league.clubs) {
    const keeping: Player[] = [];

    // A club must never release its last specialist in a position. Renewal is
    // decided on ability and affordability alone, so without this a club whose
    // only two keepers expire in the same summer ends up with none, and fields
    // an outfielder in goal for a season.
    const remaining = new Map<Position, number>();
    for (const player of club.squad) {
      remaining.set(player.position, (remaining.get(player.position) ?? 0) + 1);
    }

    for (const player of club.squad) {
      player.contract.yearsRemaining -= 1;
      if (player.contract.yearsRemaining > 0) {
        keeping.push(player);
        continue;
      }

      const ability = abilityIn(player.attributes, player.position);
      const worthKeeping =
        ability >= targetAbility(club.reputation) - 10 ||
        (player.age <= 22 && player.hiddenPotential >= targetAbility(club.reputation));
      const newWage = Math.round(expectedWage(player) * rng.float(1, 1.2));
      const affordable = wageBill(keeping) + newWage <= club.finances.wageBudget;
      const mustKeep = keeping.length + 1 <= T.minSquadSize;
      const lastInPosition = (remaining.get(player.position) ?? 0) <= 1;

      if ((worthKeeping && affordable) || mustKeep || lastInPosition) {
        player.contract = { wage: newWage, yearsRemaining: rng.int(2, 4) };
        keeping.push(player);
        renewed++;
      } else {
        released.push(player);
        remaining.set(player.position, (remaining.get(player.position) ?? 1) - 1);
      }
    }

    club.squad = keeping;
  }

  world.freeAgents.push(...released);
  return { renewed, released };
}

/** Free agents nobody signed drift out of the game after a season. */
export function expireFreeAgents(world: World): Player[] {
  const leaving = world.freeAgents;
  world.freeAgents = [];
  for (const player of leaving) world.players.delete(player.id);
  return leaving;
}
