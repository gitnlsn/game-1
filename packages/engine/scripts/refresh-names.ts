/**
 * Rebuilds src/world/nameData.generated.ts from Wikidata (CC0).
 *
 * Only aggregate statistics leave this script: how often each forename and
 * surname occurs among a country's footballers, which pairs of forenames go
 * together, and which nationalities play in each league. No player is copied,
 * and a name has to be shared by several players before it is kept, so a name
 * that would point at one real person never reaches the game.
 *
 * Runs as part of the engine build. The data changes slowly, so a fetch younger
 * than MAX_AGE_DAYS is reused, and a failed fetch keeps the committed file
 * rather than failing the build. Pass --force to refetch regardless.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/world/nameData.generated.ts');
const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'eleven-deep-namegen/1.0 (build-time name statistics; https://github.com/)';
const MAX_AGE_DAYS = 30;
/** Players born before this are skipped: forenames date quickly. */
const MIN_BIRTH_YEAR = 1980;
/** A name must be shared by at least this many players to be kept. */
const MIN_SHARED = 3;
const MAX_FIRST = 120;
const MAX_LAST = 220;
const MAX_PAIRS = 40;

interface CountrySpec {
  code: string;
  label: string;
  qids: string[];
  /** Label language to read names in; romanised countries read English. */
  lang: string;
  /** Home nations have UK citizenship, so they are told apart by country for sport. */
  byCountryForSport?: boolean;
  /** Which of several surnames the player is known by. */
  surname: 'first' | 'last';
  /** Two forenames used together, as in João Pedro. Elsewhere pairs are just nickname + full name. */
  compoundForenames?: boolean;
  /** Romanised Japanese keeps its macrons on Wikidata; football shirts drop them. */
  stripMacrons?: boolean;
}

const COUNTRIES: CountrySpec[] = [
  { code: 'BRA', compoundForenames: true, label: 'Brazil', qids: ['Q155'], lang: 'pt', surname: 'last' },
  { code: 'ARG', compoundForenames: true, label: 'Argentina', qids: ['Q414'], lang: 'es', surname: 'first' },
  { code: 'URU', compoundForenames: true, label: 'Uruguay', qids: ['Q77'], lang: 'es', surname: 'first' },
  { code: 'COL', compoundForenames: true, label: 'Colombia', qids: ['Q739'], lang: 'es', surname: 'first' },
  { code: 'PAR', compoundForenames: true, label: 'Paraguay', qids: ['Q733'], lang: 'es', surname: 'first' },
  { code: 'CHI', compoundForenames: true, label: 'Chile', qids: ['Q298'], lang: 'es', surname: 'first' },
  { code: 'ECU', compoundForenames: true, label: 'Ecuador', qids: ['Q736'], lang: 'es', surname: 'first' },
  { code: 'ESP', compoundForenames: true, label: 'Spain', qids: ['Q29'], lang: 'es', surname: 'first' },
  { code: 'POR', compoundForenames: true, label: 'Portugal', qids: ['Q45'], lang: 'pt', surname: 'last' },
  { code: 'ENG', label: 'England', qids: ['Q21'], lang: 'en', byCountryForSport: true, surname: 'last' },
  { code: 'SCO', label: 'Scotland', qids: ['Q22'], lang: 'en', byCountryForSport: true, surname: 'last' },
  { code: 'WAL', label: 'Wales', qids: ['Q25'], lang: 'en', byCountryForSport: true, surname: 'last' },
  { code: 'IRL', label: 'Ireland', qids: ['Q27'], lang: 'en', surname: 'last' },
  { code: 'FRA', label: 'France', qids: ['Q142'], lang: 'fr', surname: 'last' },
  { code: 'BEL', label: 'Belgium', qids: ['Q31'], lang: 'en', surname: 'last' },
  { code: 'NED', label: 'Netherlands', qids: ['Q55', 'Q29999'], lang: 'nl', surname: 'last' },
  { code: 'GER', label: 'Germany', qids: ['Q183'], lang: 'de', surname: 'last' },
  { code: 'ITA', label: 'Italy', qids: ['Q38'], lang: 'it', surname: 'last' },
  { code: 'NGA', label: 'Nigeria', qids: ['Q1033'], lang: 'en', surname: 'last' },
  { code: 'SEN', label: 'Senegal', qids: ['Q1041'], lang: 'fr', surname: 'last' },
  { code: 'CIV', label: 'Ivory Coast', qids: ['Q1008'], lang: 'fr', surname: 'last' },
  { code: 'GHA', label: 'Ghana', qids: ['Q117'], lang: 'en', surname: 'last' },
  { code: 'JPN', label: 'Japan', qids: ['Q17'], lang: 'en', surname: 'last', stripMacrons: true },
];

/** Leagues the game can generate, and how their clubs are found on Wikidata. */
const LEAGUES: { code: string; teamFilter: string }[] = [
  { code: 'BRA', teamFilter: '?team wdt:P17 wd:Q155.' },
  { code: 'ENG', teamFilter: '?team wdt:P131* wd:Q21.' },
];

const force = process.argv.includes('--force');

async function sparql(query: string): Promise<Record<string, string>[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        results: { bindings: Record<string, { value: string }>[] };
      };
      return json.results.bindings.map((row) =>
        Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v.value])),
      );
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}

/** A label in the country's language, else the language-neutral one, else English. */
function labelOf(item: string, out: string, lang: string): string {
  return `
    OPTIONAL { ${item} rdfs:label ${out}_l FILTER(LANG(${out}_l) = "${lang}") }
    OPTIONAL { ${item} rdfs:label ${out}_m FILTER(LANG(${out}_m) = "mul") }
    OPTIONAL { ${item} rdfs:label ${out}_e FILTER(LANG(${out}_e) = "en") }
    BIND(COALESCE(${out}_l, ${out}_m, ${out}_e) AS ${out})`;
}

function playersOf(country: CountrySpec): string {
  const prop = country.byCountryForSport ? 'P1532' : 'P27';
  return `
    VALUES ?country { ${country.qids.map((q) => `wd:${q}`).join(' ')} }
    ?p wdt:P106 wd:Q937857; wdt:P21 wd:Q6581097; wdt:${prop} ?country; wdt:P569 ?born.
    FILTER(YEAR(?born) >= ${MIN_BIRTH_YEAR})`;
}

interface Named {
  name: string;
  ordinal: number;
}

/** One row per player: their forenames and surnames, each tagged with its order. */
async function fetchPeople(country: CountrySpec): Promise<{ given: Named[]; family: Named[] }[]> {
  const part = async (prop: string) => {
    const rows = await sparql(`
      SELECT ?p ?ord ?name ?plabel WHERE {
        ${playersOf(country)}
        ?p p:${prop} ?st. ?st ps:${prop} ?item.
        OPTIONAL { ?st pq:P1545 ?ord }
        ${labelOf('?item', '?name', country.lang)}
        ${labelOf('?p', '?plabel', country.lang)}
      }`);
    return rows;
  };
  const people = new Map<string, { label: string; given: Named[]; family: Named[] }>();
  const add = (rows: Record<string, string>[], key: 'given' | 'family') => {
    for (const row of rows) {
      if (!row.name) continue;
      const person = people.get(row.p!) ?? { label: row.plabel ?? '', given: [], family: [] };
      people.set(row.p!, person);
      // Statements rarely carry an order; where they don't, the name's place in
      // the player's own label is the next best guide.
      const index = person.label.indexOf(row.name);
      const ordinal = row.ord ? Number(row.ord) : index >= 0 ? 100 + index : 1000;
      if (!person[key].some((n) => n.name === row.name)) person[key].push({ name: row.name, ordinal });
    }
  };
  add(await part('P735'), 'given');
  add(await part('P734'), 'family');
  return [...people.values()].map((p) => ({
    given: p.given.sort((a, b) => a.ordinal - b.ordinal),
    family: p.family.sort((a, b) => a.ordinal - b.ordinal),
  }));
}

const LATIN_NAME = /^[\p{Script=Latin}][\p{Script=Latin}' -]*$/u;
/** Lower-case particles that may lead a surname: da Silva, van Dijk, de Jong. */
const PARTICLES = new Set(['da', 'das', 'de', 'del', 'della', 'di', 'do', 'dos', 'du', 'la', 'le', 'van', 'von', 'der', 'den', 'ter', 'y']);

/**
 * Real names only. Every word but a particle must be capitalised, which also
 * drops vandalised labels ("artie ziff" once stood in for an Argentine forename).
 */
function usable(name: string): boolean {
  if (!LATIN_NAME.test(name) || name.length > 14) return false;
  const words = name.split(' ');
  if (words.length > 3) return false;
  return words.every((w, i) => (i < words.length - 1 && PARTICLES.has(w.toLowerCase())) || /^\p{Lu}/u.test(w));
}

/** One spelling per name: "Da Silva" and "da Silva" are the same surname. */
function normalise(name: string, country: CountrySpec): string {
  let out = name.trim().replace(/\s+/g, ' ');
  if (country.stripMacrons) out = out.normalize('NFD').replace(/\u0304/g, '').normalize('NFC');
  const words = out.split(' ');
  return words.map((w, i) => (i < words.length - 1 && PARTICLES.has(w.toLowerCase()) ? w.toLowerCase() : w)).join(' ');
}

/** Below this, a pool repeats itself within a squad. */
const THIN_POOL = 40;

/**
 * The most common names. Small countries (Wales, Belgium's scattered surnames)
 * come out too thin at MIN_SHARED, so they drop to two players -- still never a
 * name only one real player has.
 */
function top(counts: Map<string, number>, limit: number): [string, number][] {
  const pick = (min: number) =>
    [...counts.entries()]
      .filter(([, n]) => n >= min)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit);
  const common = pick(MIN_SHARED);
  return common.length >= THIN_POOL ? common : pick(2);
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

async function buildPool(country: CountrySpec) {
  const people = await fetchPeople(country);
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  const pairs = new Map<string, number>();
  const single = (name: string) => usable(name) && !name.includes(' ');
  for (const person of people) {
    const [g1, g2] = person.given.map((n) => normalise(n.name, country));
    if (g1 && usable(g1)) bump(first, g1);
    if (country.compoundForenames && g1 && g2 && g1 !== g2 && single(g1) && single(g2)) bump(pairs, `${g1} ${g2}`);
    const family = country.surname === 'first' ? person.family[0] : person.family.at(-1);
    const surname = family && normalise(family.name, country);
    if (surname && usable(surname)) bump(last, surname);
  }
  return {
    code: country.code,
    label: country.label,
    sampled: people.length,
    first: top(first, MAX_FIRST),
    last: top(last, MAX_LAST),
    pairs: top(pairs, MAX_PAIRS),
  };
}

async function buildLeagueMix(league: (typeof LEAGUES)[number]): Promise<[string, number][]> {
  const byQid = new Map<string, string>();
  for (const c of COUNTRIES) for (const q of c.qids) byQid.set(q, c.code);
  const rows = await sparql(`
    SELECT ?c (COUNT(DISTINCT ?p) AS ?n) WHERE {
      ?team wdt:P31 wd:Q476028. ${league.teamFilter}
      ?p wdt:P54 ?team; wdt:P106 wd:Q937857; wdt:P21 wd:Q6581097; wdt:P569 ?born; wdt:P27 ?cit.
      FILTER(YEAR(?born) >= ${MIN_BIRTH_YEAR + 5})
      OPTIONAL { ?p wdt:P1532 ?sport }
      BIND(COALESCE(?sport, ?cit) AS ?c)
    } GROUP BY ?c`);
  const mix = new Map<string, number>();
  for (const row of rows) {
    const code = byQid.get(row.c!.replace('http://www.wikidata.org/entity/', ''));
    if (code && code !== league.code) mix.set(code, (mix.get(code) ?? 0) + Number(row.n));
  }
  return [...mix.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function generatedAt(): Date | undefined {
  if (!existsSync(OUT)) return undefined;
  const match = /NAME_DATA_GENERATED_AT = '([^']+)'/.exec(readFileSync(OUT, 'utf8'));
  return match ? new Date(match[1]!) : undefined;
}

async function main(): Promise<void> {
  const previous = generatedAt();
  const ageDays = previous ? (Date.now() - previous.getTime()) / 86_400_000 : Infinity;
  if (!force && ageDays < MAX_AGE_DAYS) {
    console.log(`names: data is ${Math.floor(ageDays)} days old, keeping it (--force to refetch)`);
    return;
  }

  console.log('names: fetching from Wikidata...');
  try {
    const pools = [];
    for (const country of COUNTRIES) {
      const pool = await buildPool(country);
      console.log(`names: ${pool.code} ${pool.sampled} players, ${pool.first.length} forenames, ${pool.last.length} surnames`);
      if (pool.first.length < 10 || pool.last.length < 10) throw new Error(`${pool.code}: too few names`);
      pools.push(pool);
    }
    const mixes: Record<string, [string, number][]> = {};
    for (const league of LEAGUES) mixes[league.code] = await buildLeagueMix(league);

    const body = [
      '// Generated by scripts/refresh-names.ts from Wikidata (CC0). Do not edit.',
      '// Counts are how many footballers share each name; see the script for method.',
      `export const NAME_DATA_GENERATED_AT = '${new Date().toISOString()}';`,
      '',
      'export interface RawNamePool {',
      '  code: string;',
      '  label: string;',
      '  first: readonly (readonly [string, number])[];',
      '  last: readonly (readonly [string, number])[];',
      '  pairs: readonly (readonly [string, number])[];',
      '}',
      '',
      `export const RAW_NAME_POOLS: readonly RawNamePool[] = ${JSON.stringify(
        pools.map(({ sampled: _sampled, ...pool }) => pool),
      )};`,
      '',
      '/** Foreign players per league, by nationality, as counts. */',
      `export const LEAGUE_FOREIGN_MIX: Record<string, readonly (readonly [string, number])[]> = ${JSON.stringify(mixes)};`,
      '',
    ].join('\n');
    writeFileSync(OUT, body);
    console.log(`names: wrote ${OUT}`);
  } catch (error) {
    if (!previous) throw error;
    console.warn(`names: Wikidata fetch failed (${String(error)}); keeping the existing data`);
  }
}

await main();
