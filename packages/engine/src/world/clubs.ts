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
  /*
   * The countries below use invented towns, as England does. Real towns would
   * collide with real clubs constantly -- every Spanish town of any size has a
   * "CD" or a "UD" -- and a blocklist cannot keep up with that.
   */
  ESP: {
    cities: [
      'Valdemora', 'Castrillo', 'Peñaverde', 'Almedina', 'Torrealta', 'Villalobar', 'Montesierra',
      'Riosalado', 'Fuentelar', 'Navalcruz', 'Sotoverde', 'Alcaraván', 'Robledal', 'Encinar',
      'Valbuena', 'Arroyomar', 'Campoalto', 'Miraflores', 'Belmonte', 'Calanda',
    ],
    patterns: [
      (c) => `CD ${c}`,
      (c) => `${c} CF`,
      (c) => `Atlético ${c}`,
      (c) => `Real ${c}`,
      (c) => `UD ${c}`,
      (c) => `SD ${c}`,
      (c) => `Deportivo ${c}`,
    ],
  },
  ITA: {
    cities: [
      'Borgomaro', 'Castelvento', 'Sanvito', 'Roccaverde', 'Fontanella', 'Valdoria', 'Casalfiore',
      'Torrenova', 'Monteleone', 'Campobianco', 'Rivalta', 'Belforte', 'Serravalle', 'Lagomare',
      'Colleverde', 'Acquaviva', 'Sassoreale', 'Ponteluce', 'Vallescura', 'Pietralunga',
    ],
    patterns: [
      (c) => `${c} Calcio`,
      (c) => `AC ${c}`,
      (c) => `US ${c}`,
      (c) => `Sporting ${c}`,
      (c) => `Virtus ${c}`,
      (c) => `Unione ${c}`,
      (c) => `Polisportiva ${c}`,
    ],
  },
  GER: {
    cities: [
      'Altenbruck', 'Bergheide', 'Eichenfeld', 'Falkenau', 'Grünwalden', 'Hohenmark', 'Kaltenbach',
      'Lindenau', 'Neuwerden', 'Osterfeld', 'Rabenstein', 'Schwarzhagen', 'Tannenbrück',
      'Weidenstadt', 'Wolfsheide', 'Ahlenbrück', 'Birkenfurt', 'Dornstedt', 'Erlenhof', 'Steinbrück',
    ],
    patterns: [
      (c) => `FC ${c}`,
      (c) => `SV ${c}`,
      (c) => `VfB ${c}`,
      (c) => `TSV ${c}`,
      (c) => `SpVgg ${c}`,
      (c) => `Eintracht ${c}`,
      (c) => `Sportfreunde ${c}`,
    ],
  },
  FRA: {
    cities: [
      'Montclair', 'Valfleury', 'Saint-Aubry', 'Roquebelle', 'Champmorel', 'Bellerive', 'Fontclaire',
      'Port-Mareuil', 'Rochebrune', 'Vauclair', 'Saint-Gérald', 'Mirabel', 'Castelnoir',
      'Peyrelongue', 'Aubeterre', 'Valmont', 'Sainte-Odile', 'Boisjoli', 'Hautefort', 'Clairvaux',
    ],
    patterns: [
      (c) => `${c} FC`,
      (c) => `AS ${c}`,
      (c) => `Olympique ${c}`,
      (c) => `Stade ${c}`,
      (c) => `US ${c}`,
      (c) => `Racing ${c}`,
      (c) => `SC ${c}`,
    ],
  },
  ARG: {
    cities: [
      'Villa Alegre', 'Puerto Esperanza', 'Cerro Azul', 'Laguna Brava', 'Los Álamos', 'Bahía Serena',
      'Colonia Nueva', 'Río Claro', 'Paso del Indio', 'Las Acacias', 'Villa Rosales', 'General Peña',
      'Sierra Morada', 'El Ombú', 'Cañada Larga', 'Santa Brígida', 'Pampa Alta', 'San Telmo Sur',
      'Villa Ventana', 'Monte Hermoso Alto',
    ],
    patterns: [
      (c) => `Atlético ${c}`,
      (c) => `Deportivo ${c}`,
      (c) => `Sportivo ${c}`,
      (c) => `${c} Juniors`,
      (c) => `Unión ${c}`,
      (c) => `Independiente ${c}`,
      (c) => `Ferro ${c}`,
    ],
  },
  POR: {
    cities: [
      'Vale Formoso', 'Porto Claro', 'Ribeira Alta', 'Monte Sereno', 'Castelo Velho', 'Vila Serena',
      'Fontelas', 'Póvoa do Sol', 'Santa Luzia', 'Ponte Verde', 'Aldeia Grande', 'Torre Branca',
      'Lagoa Azul', 'Penedo Alto', 'Serra Nova', 'Vila Franca do Mar', 'Rio Fundo', 'Quinta Velha',
      'Campo Maior Novo', 'Alvorada',
    ],
    patterns: [
      (c) => `${c} FC`,
      (c) => `Sporting ${c}`,
      (c) => `União ${c}`,
      (c) => `Académico ${c}`,
      (c) => `Desportivo ${c}`,
      (c) => `GD ${c}`,
      (c) => `SC ${c}`,
    ],
  },
  NED: {
    cities: [
      'Bergendaal', 'Lindenhoven', 'Westerdijk', 'Oosterbroek', 'Zandvoorde', 'Molendam', 'Rijnhaven',
      'Veldhove', 'Duinwijk', 'Kerkebrug', 'Heideloo', 'Waterberg', 'Eikendorp', 'Noordmeer',
      'Sluiskerk', 'Dijkhuizen', 'Polderwijk', 'Vlietdam', 'Hoogmolen', 'Brederode',
    ],
    patterns: [
      (c) => `${c} FC`,
      (c) => `VV ${c}`,
      (c) => `SC ${c}`,
      (c) => `${c} Boys`,
      (c) => `Sparta ${c}`,
      (c) => `Quick ${c}`,
      (c) => `Excelsior ${c}`,
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

/** Three letters for the tightest places a club is named. */
export function shortNameFor(name: string): string {
  const words = name.split(' ').filter((w) => w.length > 0);
  // The club-type words around the town, in every country a career is played in.
  const meaningful = words.filter(
    (w) => !/^(FC|EC|AC|SC|CF|CD|UD|SD|AS|US|SV|VV|GD|TSV|VfB|SpVgg|Calcio|Juniors|Boys)$/i.test(w),
  );
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

export function generateSquad(
  rng: Rng,
  reputation: number,
  domesticPool: NamePool,
  takenNames: Set<string> = new Set(),
): Player[] {
  // A club's reputation sets the mean potential of the players it can attract.
  const clubBase = 30 + reputation * 0.62;
  const formation = FORMATIONS[DEFAULT_FORMATION]!;
  const starters = startersByPosition(formation);
  const squad: Player[] = [];

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
  // Shared across the division: two players called "Careca" at different clubs
  // reads as a bug when they appear together in the scoring charts.
  const takenNames = new Set<string>();
  const clubs: Club[] = [];

  for (let i = 0; i < count; i++) {
    // Reputation spread across the division, plus noise so the ladder is not
    // perfectly even -- real divisions have clusters and gaps.
    const t = count === 1 ? 0 : i / (count - 1);
    const reputation = clamp(Math.round(rng.gaussian(top - (top - bottom) * t, 2.5)), 20, 99);
    const { name, city } = generateClubName(rng, style, taken);
    const squad = generateSquad(rng, reputation, domesticPool, takenNames);

    const club: Club = {
      id: `c${i + 1}`,
      name,
      shortName: shortNameFor(name),
      city,
      nationality,
      reputation,
      squad,
      finances: createClubFinances(reputation, squad, count, rng),
    };

    // The squad was generated before the club existed, so nobody knows whose
    // they are yet.
    for (const player of club.squad) player.clubId = club.id;

    fitWagesToBudget(club);
    clubs.push(club);
  }

  return clubs;
}
