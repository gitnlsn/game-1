import { Rng, clamp } from '../rng/index.js';
import type {
  Club,
  Player,
  Position,
  Transfer,
  TransferOffer,
  TransferWindowState,
  World,
} from '../types.js';
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
export interface ShopOptions {
  /**
   * Clubs the AI must not shop on behalf of -- the one the human is managing.
   * They are still shuffled with everyone else so the RNG sequence is unchanged.
   */
  skipClubIds?: readonly string[];
}

/**
 * Everything that has to happen before anyone goes shopping: clubs clear out
 * players they do not need, and clubs in the red sell to balance the books.
 *
 * Split out so a human manager can act in the middle of a window. This must run
 * first either way, or the free-agent pool is empty and distressed clubs have
 * not listed anyone when the player comes to look.
 */
export function prepareTransferWindow(
  rng: Rng,
  world: World,
  options: ShopOptions = {},
): Transfer[] {
  const clubs = world.league.clubs;
  const transfers: Transfer[] = [];
  const skip = new Set(options.skipClubIds ?? []);

  // A skipped club does none of this automatically: trimming a squad releases
  // players and raising funds sells them, and a manager should not discover
  // after the fact that the computer has cashed in their best player.
  for (const club of clubs) {
    if (!skip.has(club.id)) trimSquad(world, club);
  }
  for (const club of clubs) {
    if (!skip.has(club.id)) transfers.push(...raiseFunds(rng, world, club));
  }

  return transfers;
}

/** The AI half of a window: every club works down its own list of squad needs. */
export function shopTransferWindow(
  rng: Rng,
  world: World,
  options: ShopOptions = {},
): Transfer[] {
  const T = TRANSFER_TUNING;
  const transfers: Transfer[] = [];
  const clubs = world.league.clubs;
  const skip = new Set(options.skipClubIds ?? []);

  // Shuffled over every club, skipped or not, so the draw sequence does not
  // depend on who is being skipped.
  for (const club of rng.shuffle(clubs)) {
    if (skip.has(club.id)) continue;
    let signings = 0;

    // Work down the weakest positions. Clubs shop to improve, not only when they
    // have fallen below the standard their reputation implies -- a strong club
    // with money in the bank still wants a better left back.
    for (const need of squadNeeds(club).slice(0, T.positionsShoppedPerWindow)) {
      if (signings >= T.maxSigningsPerWindow) break;
      if (club.squad.length >= T.maxSquadSize) break;

      const candidate = findBestCandidate(rng, world, club, need.position, need.current, skip);
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
 * A whole window at once. With no options the call sequence is exactly what it
 * was before the split, so the headless validators cannot move.
 */
export function runTransferWindow(
  rng: Rng,
  world: World,
  options: ShopOptions = {},
): Transfer[] {
  return [
    ...prepareTransferWindow(rng, world, options),
    ...shopTransferWindow(rng, world, options),
  ];
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
  skipSellers: ReadonlySet<string> = new Set(),
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
    if (seller && skipSellers.has(seller.id)) continue;
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


// --- The window as something a manager acts in -----------------------------

export interface MarketListing {
  player: Player;
  /** Empty string for a free agent. */
  sellerClubId: string;
  sellerClubName: string;
  /** What the selling club wants. A free agent costs nothing. */
  askingPrice: number;
  /** What he would expect to earn at your club. */
  expectedWage: number;
  /** Would he actually come? */
  wouldJoin: boolean;
  /** Fee within budget and wage within the bill -- the same tests the AI applies. */
  affordable: boolean;
}

export interface BrowseOptions {
  position?: Position;
  maxFee?: number;
  maxAge?: number;
  minAbility?: number;
  /** Only players the buyer could actually sign. */
  affordableOnly?: boolean;
  limit?: number;
}

/**
 * Everyone who could be bought, priced and gated by exactly the rules the AI
 * plays by. A manager sees the same market the computer does, including whether
 * a player would deign to come.
 */
export function transferTargets(
  world: World,
  buyerClubId: string,
  options: BrowseOptions = {},
): MarketListing[] {
  const T = TRANSFER_TUNING;
  const buyer = world.league.clubs.find((c) => c.id === buyerClubId);
  if (!buyer) return [];

  const listings: MarketListing[] = [];

  const consider = (player: Player, seller: Club | undefined) => {
    if (options.position && player.position !== options.position) return;
    if (options.maxAge !== undefined && player.age > options.maxAge) return;
    if (options.minAbility !== undefined && ability(player.attributes, player.position) < options.minAbility) {
      return;
    }

    // A club will not sell its only specialist, nor cut below the squad floor.
    if (seller && (seller.squad.length <= T.minSquadSize || depthAt(seller, player.position) <= 1)) {
      return;
    }

    const price = seller ? askingPrice(seller, player) : 0;
    if (options.maxFee !== undefined && price > options.maxFee) return;

    const wage = expectedWage(player);
    const wageRoom =
      wageBill(buyer.squad) + wage * T.moveWageMax <= buyer.finances.wageBudget * T.wageBudgetCeiling;
    const affordable = wageRoom && (!seller || buyer.finances.transferBudget >= price);
    if (options.affordableOnly && !affordable) return;

    listings.push({
      player,
      sellerClubId: seller?.id ?? '',
      sellerClubName: seller?.name ?? 'Free agent',
      askingPrice: price,
      expectedWage: wage,
      wouldJoin: playerWouldJoin(player, seller, buyer),
      affordable,
    });
  };

  for (const player of world.freeAgents) consider(player, undefined);
  for (const club of world.league.clubs) {
    if (club.id === buyerClubId) continue;
    for (const player of club.squad) consider(player, club);
  }

  /*
   * Players you could actually sign come first. Sorting by ability alone fills
   * the top of the list with the league's best, every one of them out of reach,
   * and buries the ones worth considering pages down.
   */
  const reachable = (l: MarketListing) => (l.affordable && l.wouldJoin ? 1 : 0);
  listings.sort(
    (a, b) =>
      reachable(b) - reachable(a) ||
      ability(b.player.attributes, b.player.position) -
        ability(a.player.attributes, a.player.position),
  );
  return options.limit ? listings.slice(0, options.limit) : listings;
}

export type BidRejection =
  | 'below_asking'
  | 'no_budget'
  | 'no_wage_room'
  | 'would_not_join'
  | 'seller_will_not_sell'
  | 'buyer_squad_full'
  | 'unknown_player';

export interface BidOutcome {
  accepted: boolean;
  reason?: BidRejection;
  /** What the seller would actually take, when a bid was simply too low. */
  counterFee?: number;
  transfer?: Transfer;
}

/**
 * Bids for a player. Resolved immediately and against the same gates the AI
 * uses, so the human has no advantage beyond being able to choose.
 */
export function makeBid(
  rng: Rng,
  world: World,
  buyerClubId: string,
  playerId: string,
  fee: number,
  wageOffer?: number,
): BidOutcome {
  const T = TRANSFER_TUNING;
  const buyer = world.league.clubs.find((c) => c.id === buyerClubId);
  if (!buyer) return { accepted: false, reason: 'unknown_player' };

  const seller = world.league.clubs.find(
    (c) => c.id !== buyerClubId && c.squad.some((p) => p.id === playerId),
  );
  const player = seller
    ? seller.squad.find((p) => p.id === playerId)
    : world.freeAgents.find((p) => p.id === playerId);
  if (!player) return { accepted: false, reason: 'unknown_player' };

  if (buyer.squad.length >= T.maxSquadSize) return { accepted: false, reason: 'buyer_squad_full' };
  if (!playerWouldJoin(player, seller, buyer)) return { accepted: false, reason: 'would_not_join' };

  if (seller) {
    if (seller.squad.length <= T.minSquadSize || depthAt(seller, player.position) <= 1) {
      return { accepted: false, reason: 'seller_will_not_sell' };
    }
    const price = askingPrice(seller, player);
    if (fee < price) return { accepted: false, reason: 'below_asking', counterFee: price };
    if (buyer.finances.transferBudget < fee) return { accepted: false, reason: 'no_budget' };
  }

  const wage = Math.max(
    Math.round(expectedWage(player) * T.moveWageMin),
    Math.round(wageOffer ?? expectedWage(player) * T.moveWageMax),
  );
  if (wageBill(buyer.squad) + wage > buyer.finances.wageBudget * T.wageBudgetCeiling) {
    return { accepted: false, reason: 'no_wage_room' };
  }

  const paid = seller ? fee : 0;
  if (seller) {
    seller.squad = seller.squad.filter((p) => p.id !== player.id);
    seller.finances.balance += paid;
    seller.finances.season.playerSales += paid;
  } else {
    world.freeAgents = world.freeAgents.filter((p) => p.id !== player.id);
  }

  buyer.finances.balance -= paid;
  buyer.finances.transferBudget -= paid;
  buyer.finances.season.playerPurchases += paid;

  player.contract = { wage, yearsRemaining: rng.int(2, 5) };
  buyer.squad.push(player);
  world.players.set(player.id, player);

  const transfer: Transfer = {
    playerId: player.id,
    playerName: player.displayName,
    fromClubId: seller?.id ?? '',
    toClubId: buyer.id,
    fee: paid,
    wage,
    free: seller === undefined,
  };
  world.transferWindow?.completed.push(transfer);
  return { accepted: true, transfer };
}

/** Lets a player go for nothing. Refused if it would leave the club short. */
export function releasePlayer(world: World, clubId: string, playerId: string): boolean {
  const T = TRANSFER_TUNING;
  const club = world.league.clubs.find((c) => c.id === clubId);
  const player = club?.squad.find((p) => p.id === playerId);
  if (!club || !player) return false;
  if (club.squad.length <= T.minSquadSize) return false;
  if (depthAt(club, player.position) <= 1) return false;

  club.squad = club.squad.filter((p) => p.id !== playerId);
  world.freeAgents.push(player);
  return true;
}

/** Renews a contract on the terms offered. Refused if the wage bill will not take it. */
export function offerContract(
  world: World,
  clubId: string,
  playerId: string,
  wage: number,
  years: number,
): boolean {
  const T = TRANSFER_TUNING;
  const club = world.league.clubs.find((c) => c.id === clubId);
  const player = club?.squad.find((p) => p.id === playerId);
  if (!club || !player) return false;

  // He will not take a pay cut to stay.
  if (wage < expectedWage(player)) return false;

  const others = wageBill(club.squad) - player.contract.wage;
  if (others + wage > club.finances.wageBudget * T.wageBudgetCeiling) return false;

  player.contract = { wage: Math.round(wage), yearsRemaining: clamp(Math.round(years), 1, 5) };
  return true;
}

let offerCounter = 0;

/**
 * The bids AI clubs would have made for your players, now needing your answer.
 *
 * Without this the window is one-directional: the computer quietly takes your
 * best player (raiseFunds and findBestCandidate both reach into every squad) and
 * you find out afterwards.
 */
export function generateIncomingOffers(
  rng: Rng,
  world: World,
  managedClubId: string,
): TransferOffer[] {
  const T = TRANSFER_TUNING;
  const managed = world.league.clubs.find((c) => c.id === managedClubId);
  if (!managed) return [];

  const offers: TransferOffer[] = [];

  for (const buyer of rng.shuffle(world.league.clubs)) {
    if (buyer.id === managedClubId) continue;
    if (buyer.squad.length >= T.maxSquadSize) continue;

    let best: Player | undefined;
    let bestScore = -Infinity;

    for (const need of squadNeeds(buyer).slice(0, T.positionsShoppedPerWindow)) {
      for (const player of managed.squad) {
        if (depthAt(managed, player.position) <= 1) continue;
        const quality =
          ability(player.attributes, need.position) *
          positionFamiliarity(player.position, need.position);
        if (quality < need.current + T.improvementThreshold) continue;
        if (!playerWouldJoin(player, managed, buyer)) continue;
        if (!buyerCanAfford(buyer, player, managed)) continue;
        if (quality > bestScore) {
          bestScore = quality;
          best = player;
        }
      }
    }

    if (!best) continue;
    if (offers.some((o) => o.playerId === best!.id)) continue;

    offers.push({
      id: `o${++offerCounter}`,
      playerId: best.id,
      playerName: best.displayName,
      buyerClubId: buyer.id,
      buyerClubName: buyer.name,
      sellerClubId: managedClubId,
      fee: askingPrice(managed, best),
      wage: Math.round(expectedWage(best) * rng.float(T.moveWageMin, T.moveWageMax)),
      years: rng.int(2, 5),
      status: 'pending',
    });
  }

  return offers;
}

/** Accepts or rejects a bid for one of your players. */
export function respondToOffer(
  world: World,
  offerId: string,
  response: 'accept' | 'reject',
): Transfer | undefined {
  const window = world.transferWindow;
  const offer = window?.incoming.find((o) => o.id === offerId);
  if (!window || !offer || offer.status !== 'pending') return undefined;

  if (response === 'reject') {
    offer.status = 'rejected';
    return undefined;
  }

  const seller = world.league.clubs.find((c) => c.id === offer.sellerClubId);
  const buyer = world.league.clubs.find((c) => c.id === offer.buyerClubId);
  const player = seller?.squad.find((p) => p.id === offer.playerId);
  if (!seller || !buyer || !player) {
    offer.status = 'rejected';
    return undefined;
  }

  seller.squad = seller.squad.filter((p) => p.id !== player.id);
  seller.finances.balance += offer.fee;
  seller.finances.season.playerSales += offer.fee;
  buyer.finances.balance -= offer.fee;
  buyer.finances.transferBudget -= offer.fee;
  buyer.finances.season.playerPurchases += offer.fee;

  player.contract = { wage: offer.wage, yearsRemaining: offer.years };
  buyer.squad.push(player);
  offer.status = 'accepted';

  const transfer: Transfer = {
    playerId: player.id,
    playerName: player.displayName,
    fromClubId: seller.id,
    toClubId: buyer.id,
    fee: offer.fee,
    wage: offer.wage,
    free: false,
  };
  window.completed.push(transfer);
  return transfer;
}

export function createTransferWindow(season: number): TransferWindowState {
  return { open: true, season, incoming: [], completed: [] };
}
