import type { Rng } from '../rng/index.js';
import type { Player } from '../types.js';
import { LEAGUE_FOREIGN_MIX, RAW_NAME_POOLS, type RawNamePool } from './nameData.generated.js';

/**
 * Fully fictional players built from per-nationality name pools. Deliberately no
 * real-player database: real squad data is licensed, and a fresh world each save
 * is better for the game anyway.
 *
 * The pools are statistics, not people: how often each forename and surname
 * occurs among a country's footballers on Wikidata, refreshed at build time by
 * scripts/refresh-names.ts. Drawing by that frequency is what makes a squad read
 * right -- a Brazilian side has several Silvas and one Fonseca, not one of each.
 */
export interface NamePool {
  code: string;
  label: string;
  first: readonly string[];
  firstWeights: readonly number[];
  last: readonly string[];
  lastWeights: readonly number[];
  /** Forenames used together, as in João Pedro. Empty where that isn't a habit. */
  pairs: readonly string[];
  pairWeights: readonly number[];
  style: NamingStyle;
}

interface NamingStyle {
  /** Chance a player goes by a single name (Brazilian style). */
  mononymChance: number;
  /** Chance a player goes by two forenames and no surname: Bruno Henrique. */
  pairChance: number;
  /** "Gabriel Barbosa" where the whole name is what fans call him, else "G. Barbosa". */
  fullNames: boolean;
  /** Nickname built from the forename, when a mononym is drawn. */
  nickname?: (first: string, rng: Rng) => string;
}

/**
 * Squeezes the raw counts so the long tail still turns up. Real frequencies
 * are steep enough that a league of 500 would be a third Silva.
 */
const WEIGHT_EXPONENT = 0.7;

/** Portuguese diminutives: Paulo → Paulinho, Marcos → Marquinhos, Diego → Dieguinho. */
function portugueseDiminutive(first: string): string | undefined {
  const special: Record<string, string> = {
    Rafael: 'Rafinha', Eduardo: 'Dudu', José: 'Zé', Guilherme: 'Gui',
    Gabriel: 'Biel', Lucas: 'Luquinhas', João: 'Joãozinho', Luiz: 'Luizinho', Luís: 'Luisinho',
    Alexandre: 'Xandinho', Fabiano: 'Fabinho', Júnior: 'Juninho', William: 'Willian',
  };
  if (special[first]) return special[first];
  const stem = (s: string) => s.replace(/c$/, 'qu').replace(/g$/, 'gu');
  if (/[^aeiou]o$/.test(first)) return `${stem(first.slice(0, -1))}inho`;
  if (/[^aeiou]os$/.test(first)) return `${stem(first.slice(0, -2))}inhos`;
  return undefined;
}

function lusophoneNickname(first: string, rng: Rng): string {
  const diminutive = portugueseDiminutive(first);
  const roll = rng.next();
  if (diminutive && roll < 0.4) return diminutive;
  if (roll < 0.52) return `${first} Júnior`;
  // Most Brazilian "mononyms" are simply the forename: Everton, Wesley, Danilo.
  return first;
}

function spanishNickname(first: string): string {
  const short: Record<string, string> = {
    Daniel: 'Dani', Ignacio: 'Nacho', Francisco: 'Fran', Alejandro: 'Álex', Rodrigo: 'Rodri',
    Jesús: 'Chus', Manuel: 'Manu', Santiago: 'Santi', Joaquín: 'Joaquín', Sebastián: 'Sebas',
  };
  return short[first] ?? first;
}

/**
 * Nicknames the rules above can reach that belong to one famous player. A
 * Série B right back called Ronaldinho reads as a joke, not as realism.
 */
const RESERVED_NICKNAMES = new Set([
  'Ronaldo', 'Ronaldinho', 'Romário', 'Rivaldo', 'Marcelo', 'Casemiro', 'Kaká', 'Neymar', 'Neymar Júnior',
  'Vinícius Júnior', 'Vini', 'Cristiano', 'Deco', 'Rodri', 'Pedri', 'Isco',
]);

const DEFAULT_STYLE: NamingStyle = { mononymChance: 0, pairChance: 0, fullNames: false };
const HISPANIC: NamingStyle = { mononymChance: 0.03, pairChance: 0.04, fullNames: false, nickname: spanishNickname };

const STYLES: Record<string, NamingStyle> = {
  BRA: { mononymChance: 0.35, pairChance: 0.12, fullNames: true, nickname: lusophoneNickname },
  POR: { mononymChance: 0.15, pairChance: 0.1, fullNames: true, nickname: lusophoneNickname },
  ESP: { ...HISPANIC, mononymChance: 0.08 },
  ARG: HISPANIC,
  URU: HISPANIC,
  COL: HISPANIC,
  PAR: HISPANIC,
  CHI: HISPANIC,
  ECU: HISPANIC,
};

function toPool(raw: RawNamePool): NamePool {
  const names = (entries: RawNamePool['first']) => entries.map(([name]) => name);
  const weights = (entries: RawNamePool['first']) => entries.map(([, n]) => n ** WEIGHT_EXPONENT);
  return {
    code: raw.code,
    label: raw.label,
    first: names(raw.first),
    firstWeights: weights(raw.first),
    last: names(raw.last),
    lastWeights: weights(raw.last),
    pairs: names(raw.pairs),
    pairWeights: weights(raw.pairs),
    style: STYLES[raw.code] ?? DEFAULT_STYLE,
  };
}

export const NAME_POOLS: readonly NamePool[] = RAW_NAME_POOLS.map(toPool);

export const NAME_POOL_BY_CODE = new Map(NAME_POOLS.map((p) => [p.code, p]));

/**
 * Share of a league's players who are home-grown. Brazilian squads are
 * overwhelmingly Brazilian; English ones much less so.
 */
const DOMESTIC_SHARE: Record<string, number> = {
  BRA: 0.85, ENG: 0.6, ARG: 0.85, ITA: 0.55, ESP: 0.6, GER: 0.55, FRA: 0.6, POR: 0.5, NED: 0.6,
};

/**
 * Where a league recruits from, for the leagues the name data does not measure.
 * Rough weights from where each league's foreign players have come from
 * historically -- the shape matters, not the exact numbers.
 */
const FALLBACK_FOREIGN_MIX: Record<string, readonly (readonly [string, number])[]> = {
  ESP: [['ARG', 30], ['FRA', 20], ['BRA', 18], ['POR', 14], ['URU', 12], ['COL', 10], ['NED', 6], ['SEN', 6], ['GER', 4], ['ITA', 4]],
  ITA: [['BRA', 22], ['ARG', 22], ['FRA', 14], ['ESP', 10], ['NED', 8], ['URU', 8], ['GER', 6], ['SEN', 6], ['NGA', 6], ['POR', 6], ['BEL', 6], ['COL', 4]],
  GER: [['NED', 14], ['FRA', 14], ['BEL', 8], ['ESP', 6], ['BRA', 8], ['ITA', 4], ['ENG', 6], ['GHA', 6], ['JPN', 8], ['CIV', 4], ['POR', 4], ['SCO', 2]],
  FRA: [['SEN', 22], ['CIV', 20], ['BEL', 10], ['POR', 10], ['BRA', 10], ['NGA', 8], ['GHA', 6], ['ESP', 6], ['ARG', 6], ['NED', 4], ['ITA', 4]],
  ARG: [['URU', 30], ['PAR', 26], ['COL', 18], ['CHI', 14], ['ECU', 8], ['ESP', 4]],
  POR: [['BRA', 50], ['ESP', 10], ['ARG', 8], ['COL', 8], ['URU', 6], ['SEN', 6], ['NGA', 6], ['FRA', 6], ['GHA', 4], ['CIV', 4], ['JPN', 2]],
  NED: [['BEL', 30], ['GER', 12], ['GHA', 8], ['NGA', 8], ['FRA', 8], ['ESP', 6], ['POR', 6], ['ENG', 4], ['JPN', 6], ['BRA', 4], ['ARG', 4]],
};
const DEFAULT_DOMESTIC_SHARE = 0.62;

/**
 * The nationality of a player joining a club in `domestic`'s league. Foreigners
 * come from where that league really recruits -- Brazil from its neighbours,
 * England from Ireland, Scotland and France -- rather than evenly from everywhere.
 */
export function pickNationality(rng: Rng, domestic: NamePool): NamePool {
  if (rng.chance(DOMESTIC_SHARE[domestic.code] ?? DEFAULT_DOMESTIC_SHARE)) return domestic;
  const mix = (LEAGUE_FOREIGN_MIX[domestic.code] ?? FALLBACK_FOREIGN_MIX[domestic.code] ?? []).filter(
    ([code]) => NAME_POOL_BY_CODE.has(code),
  );
  if (mix.length === 0) return rng.pick(NAME_POOLS.filter((p) => p !== domestic));
  const [code] = mix[rng.weightedIndex(mix.map(([, n]) => n))]!;
  return NAME_POOL_BY_CODE.get(code)!;
}

export interface GeneratedName {
  firstName: string;
  lastName: string;
  displayName: string;
}

export function pickSurname(rng: Rng, pool: NamePool): string {
  return pool.last[rng.weightedIndex(pool.lastWeights)]!;
}

/** "Gabriel Barbosa" or "G. Barbosa", as the pool's country would print it. */
export function formatName(pool: NamePool, firstName: string, lastName: string): string {
  return pool.style.fullNames ? `${firstName} ${lastName}` : `${firstName.charAt(0)}. ${lastName}`;
}

export function generateName(rng: Rng, pool: NamePool): GeneratedName {
  const { style } = pool;
  const lastName = pickSurname(rng, pool);

  if (pool.pairs.length > 0 && rng.chance(style.pairChance)) {
    const pair = pool.pairs[rng.weightedIndex(pool.pairWeights)]!;
    return { firstName: pair, lastName, displayName: pair };
  }

  const firstName = pool.first[rng.weightedIndex(pool.firstWeights)]!;
  if (style.nickname && rng.chance(style.mononymChance)) {
    const nickname = style.nickname(firstName, rng);
    if (!RESERVED_NICKNAMES.has(nickname)) return { firstName, lastName, displayName: nickname };
  }

  return { firstName, lastName, displayName: formatName(pool, firstName, lastName) };
}

/**
 * The name for a shirt or a pitch slot: the surname where fans use one, else
 * whatever the player goes by. "G. Barbosa" and "Gabriel Barbosa" are Barbosa;
 * "Dudu" and "João Pedro" stay as they are.
 */
export function shirtName(player: Pick<Player, 'displayName' | 'lastName'>): string {
  const { displayName, lastName } = player;
  if (lastName && displayName.endsWith(` ${lastName}`)) return lastName;
  const initialled = /^\p{Lu}\. (.+)$/u.exec(displayName);
  return initialled ? initialled[1]! : displayName;
}
