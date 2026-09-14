import { Rng, clamp } from '../rng/index.js';
import type { Club, Player, Position } from '../types.js';
import { NAME_POOL_BY_CODE, type NamePool } from './names.js';
import { generatePlayer } from './players.js';
import { createClubFinances, fitWagesToBudget } from '../economy/finances.js';
import { DEFAULT_FORMATION, FORMATIONS, SQUAD_SHAPE } from './positions.js';

interface ClubNamingStyle {
  cities: readonly string[];
  patterns: readonly ((city: string) => string)[];
}

const CLUB_STYLES: Record<string, ClubNamingStyle> = {
  BRA: {
    cities: [
      'Curitiba', 'Salvador', 'Fortaleza', 'Belem', 'Manaus', 'Goiania', 'Campinas',
      'Natal', 'Maceio', 'Vitoria', 'Londrina', 'Uberlandia', 'Joinville', 'Niteroi',
      'Sorocaba', 'Caxias', 'Teresina', 'Cuiaba', 'Aracaju', 'Piracicaba', 'Marilia',
      'Bauru', 'Pelotas', 'Itajai', 'Varginha',
    ],
    patterns: [
      (c) => `${c} FC`,
      (c) => `Atletico ${c}`,
      (c) => `${c} EC`,
      (c) => `Uniao ${c}`,
      (c) => `Gremio ${c}`,
      (c) => `Clube ${c}`,
      (c) => `Real ${c}`,
      (c) => `${c} AC`,
    ],
  },
  ENG: {
    cities: [
      'Ashford', 'Brentwood', 'Carlisle', 'Dunmore', 'Eastvale', 'Fairport', 'Grimsby',
      'Hallowby', 'Ironbridge', 'Kingsmere', 'Langford', 'Marsden', 'Northwick', 'Oakley',
      'Prestbury', 'Redmoor', 'Stanmore', 'Thornbury', 'Westcliff', 'Yardley',
    ],
    patterns: [
      (c) => `${c} United`,
      (c) => `${c} City`,
      (c) => `${c} Town`,
      (c) => `${c} Athletic`,
      (c) => `${c} Rovers`,
      (c) => `${c} Wanderers`,
      (c) => `${c} FC`,
    ],
  },
};

/**
 * Real clubs whose names the generator must never produce. The pools are
 * fictional by design, but city + prefix combinations can stumble onto a real
 * name by accident.
 */
const BLOCKED_NAMES = new Set(
  [
    'atletico curitiba', 'gremio curitiba', 'atletico goiania', 'vitoria fc', 'clube vitoria',
    'atletico vitoria', 'real vitoria', 'uniao vitoria', 'gremio vitoria', 'fortaleza ec',
    'atletico fortaleza', 'ceara fc', 'joinville ec', 'londrina ec', 'gremio maceio',
    'carlisle united', 'grimsby town',
  ].map((n) => n.toLowerCase()),
);

function generateClubName(rng: Rng, style: ClubNamingStyle, taken: Set<string>): { name: string; city: string } {
  for (let attempt = 0; attempt < 200; attempt++) {
    const city = rng.pick(style.cities);
    const name = rng.pick(style.patterns)(city);
    const key = name.toLowerCase();
    if (!taken.has(key) && !BLOCKED_NAMES.has(key)) {
      taken.add(key);
      return { name, city };
    }
  }
  throw new Error('generateClubName: exhausted name combinations');
}

function shortNameFor(name: string): string {
  const words = name.split(' ').filter((w) => w.length > 0);
  const meaningful = words.filter((w) => !/^(FC|EC|AC|SC)$/i.test(w));
  const base = meaningful[meaningful.length - 1] ?? words[0]!;
  return base.slice(0, 3).toUpperCase();
}

/** Starters per position in the club's default formation, used for depth tiers. */
function startersByPosition(formation: readonly Position[]): Map<Position, number> {
  const counts = new Map<Position, number>();
  for (const slot of formation) counts.set(slot, (counts.get(slot) ?? 0) + 1);
  return counts;
}

/** Quality drop for each successive player at the same position. */
const DEPTH_PENALTY: readonly number[] = [0, -3, -7, -11, -14];

export function generateSquad(rng: Rng, reputation: number, domesticPool: NamePool): Player[] {
  // A club's reputation sets the mean potential of the players it can attract.
  const clubBase = 30 + reputation * 0.62;
  const formation = FORMATIONS[DEFAULT_FORMATION]!;
  const starters = startersByPosition(formation);
  const squad: Player[] = [];
  const takenNames = new Set<string>();

  for (const position of Object.keys(SQUAD_SHAPE) as Position[]) {
    const count = SQUAD_SHAPE[position];
    const starterCount = starters.get(position) ?? 0;

    for (let index = 0; index < count; index++) {
      // Backups are worse, but a squad position with no starting slot (an AM in
      // a 4-3-3) is not penalised for it -- the lineup picker can still use them.
      const depthIndex = Math.max(0, index - Math.max(0, starterCount - 1));
      const penalty = DEPTH_PENALTY[Math.min(depthIndex, DEPTH_PENALTY.length - 1)]!;

      squad.push(
        generatePlayer(rng, {
          position,
          potentialTarget: clamp(clubBase + penalty, 25, 95),
          domesticPool,
          takenNames,
        }),
      );
    }
  }

  return squad;
}

export interface GenerateClubsOptions {
  count: number;
  nationality: string;
  /** Reputation of the strongest and weakest club in the division. */
  topReputation?: number;
  bottomReputation?: number;
}

export function generateClubs(rng: Rng, options: GenerateClubsOptions): Club[] {
  const { count, nationality } = options;
  const top = options.topReputation ?? 80;
  const bottom = options.bottomReputation ?? 54;

  const style = CLUB_STYLES[nationality] ?? CLUB_STYLES.ENG!;
  const domesticPool = NAME_POOL_BY_CODE.get(nationality) ?? NAME_POOL_BY_CODE.get('ENG')!;
  const taken = new Set<string>();
  const clubs: Club[] = [];

  for (let i = 0; i < count; i++) {
    // Reputation spread across the division, plus noise so the ladder is not
    // perfectly even -- real divisions have clusters and gaps.
    const t = count === 1 ? 0 : i / (count - 1);
    const reputation = clamp(Math.round(rng.gaussian(top - (top - bottom) * t, 2.5)), 20, 99);
    const { name, city } = generateClubName(rng, style, taken);
    const squad = generateSquad(rng, reputation, domesticPool);

    const club: Club = {
      id: `c${i + 1}`,
      name,
      shortName: shortNameFor(name),
      city,
      nationality,
      reputation,
      squad,
      finances: createClubFinances(reputation, squad, count),
    };

    fitWagesToBudget(club);
    clubs.push(club);
  }

  return clubs;
}
