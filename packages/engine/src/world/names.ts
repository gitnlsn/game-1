import type { Rng } from '../rng/index.js';

/**
 * Fully fictional players built from per-nationality name pools. Deliberately no
 * real-player database: real squad data is licensed, and a fresh world each save
 * is better for the game anyway.
 */
export interface NamePool {
  code: string;
  label: string;
  first: readonly string[];
  last: readonly string[];
  /** Chance a player from here goes by a single name (Brazilian style). */
  mononymChance: number;
  /** Nicknames used as mononyms, when mononymChance fires. */
  mononyms?: readonly string[];
}

export const NAME_POOLS: readonly NamePool[] = [
  {
    code: 'BRA',
    label: 'Brazil',
    mononymChance: 0.55,
    first: ['Gabriel', 'Lucas', 'Matheus', 'Rafael', 'Thiago', 'Bruno', 'Felipe', 'Rodrigo', 'Vinicius', 'Caio', 'Douglas', 'Everton', 'Fabricio', 'Igor', 'Juliano', 'Leandro', 'Murilo', 'Otavio', 'Renan', 'Wesley'],
    last: ['Silva', 'Santos', 'Oliveira', 'Souza', 'Pereira', 'Costa', 'Almeida', 'Ferreira', 'Rodrigues', 'Barbosa', 'Ribeiro', 'Cardoso', 'Nascimento', 'Moreira', 'Teixeira', 'Machado', 'Correia', 'Azevedo', 'Batista', 'Fonseca'],
    mononyms: ['Juninho', 'Rafinha', 'Kaka', 'Fred', 'Dedé', 'Zezinho', 'Vitinho', 'Gabigol', 'Everaldo', 'Tico', 'Dudu', 'Nenê', 'Cafu', 'Lelê', 'Betinho', 'Ronaldinho', 'Careca', 'Serginho', 'Paulinho', 'Marcelinho'],
  },
  {
    code: 'ARG',
    label: 'Argentina',
    mononymChance: 0,
    first: ['Santiago', 'Mateo', 'Nicolas', 'Franco', 'Julian', 'Emiliano', 'Agustin', 'Lautaro', 'Facundo', 'Tomas', 'Joaquin', 'Ezequiel', 'Gonzalo', 'Ignacio', 'Federico', 'Lucas', 'Martin', 'Alejandro', 'Cristian', 'Rodrigo'],
    last: ['Gomez', 'Fernandez', 'Lopez', 'Martinez', 'Romero', 'Sosa', 'Alvarez', 'Benitez', 'Acosta', 'Medina', 'Herrera', 'Aguirre', 'Molina', 'Ortiz', 'Rojas', 'Paredes', 'Cabrera', 'Peralta', 'Vega', 'Correa'],
  },
  {
    code: 'ESP',
    label: 'Spain',
    mononymChance: 0.1,
    first: ['Alvaro', 'Sergio', 'Pablo', 'Javier', 'Carlos', 'Marco', 'Adrian', 'Ruben', 'Iker', 'Unai', 'Aitor', 'Borja', 'Dani', 'Hugo', 'Mikel', 'Oscar', 'Raul', 'Victor', 'Jorge', 'Nacho'],
    last: ['Garcia', 'Hernandez', 'Ruiz', 'Torres', 'Navarro', 'Castillo', 'Iglesias', 'Serrano', 'Vidal', 'Blanco', 'Gallego', 'Ramos', 'Sanz', 'Lorenzo', 'Marin', 'Cano', 'Bravo', 'Duran', 'Gil', 'Soler'],
    mononyms: ['Isco', 'Koke', 'Nolito', 'Joselu', 'Cucho', 'Canales', 'Pedri', 'Gavi'],
  },
  {
    code: 'ENG',
    label: 'England',
    mononymChance: 0,
    first: ['Harry', 'Jack', 'Callum', 'Oliver', 'Reece', 'Marcus', 'Declan', 'Mason', 'Jordan', 'Ethan', 'Connor', 'Lewis', 'Tyler', 'Bailey', 'Kieran', 'Ollie', 'Charlie', 'Ben', 'Joe', 'Sam'],
    last: ['Smith', 'Walker', 'Wright', 'Hughes', 'Bennett', 'Palmer', 'Foster', 'Hayes', 'Mitchell', 'Barnes', 'Clarke', 'Dawson', 'Ellis', 'Fletcher', 'Grant', 'Holden', 'Kerr', 'Lawrence', 'Norris', 'Pearce'],
  },
  {
    code: 'FRA',
    label: 'France',
    mononymChance: 0,
    first: ['Hugo', 'Theo', 'Lucas', 'Enzo', 'Nathan', 'Maxime', 'Antoine', 'Clement', 'Florian', 'Kylian', 'Romain', 'Yanis', 'Baptiste', 'Corentin', 'Jules', 'Mathis', 'Quentin', 'Sofiane', 'Thomas', 'Valentin'],
    last: ['Dubois', 'Laurent', 'Lefevre', 'Moreau', 'Girard', 'Fontaine', 'Rousseau', 'Mercier', 'Blanchard', 'Chevalier', 'Perrin', 'Marchand', 'Renaud', 'Barbier', 'Guerin', 'Leclerc', 'Boucher', 'Faure', 'Dumont', 'Vasseur'],
  },
  {
    code: 'GER',
    label: 'Germany',
    mononymChance: 0,
    first: ['Leon', 'Jonas', 'Niklas', 'Maximilian', 'Felix', 'Tim', 'Lukas', 'Julian', 'Moritz', 'Fabian', 'Jannik', 'Marvin', 'Philipp', 'Sebastian', 'Tobias', 'Dennis', 'Kevin', 'Florian', 'Simon', 'Nico'],
    last: ['Muller', 'Schmidt', 'Weber', 'Wagner', 'Becker', 'Hoffmann', 'Schafer', 'Koch', 'Richter', 'Klein', 'Wolf', 'Neumann', 'Zimmermann', 'Braun', 'Krause', 'Hartmann', 'Lange', 'Werner', 'Kruger', 'Vogel'],
  },
  {
    code: 'ITA',
    label: 'Italy',
    mononymChance: 0,
    first: ['Lorenzo', 'Matteo', 'Alessandro', 'Davide', 'Federico', 'Andrea', 'Simone', 'Giacomo', 'Riccardo', 'Nicolo', 'Stefano', 'Marco', 'Gianluca', 'Emanuele', 'Fabio', 'Luca', 'Pietro', 'Salvatore', 'Tommaso', 'Vincenzo'],
    last: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Mancini', 'Costa', 'Giordano', 'Rizzo', 'Lombardi', 'Barbieri'],
  },
  {
    code: 'NED',
    label: 'Netherlands',
    mononymChance: 0,
    first: ['Daan', 'Sven', 'Bram', 'Lars', 'Jurgen', 'Ruud', 'Stijn', 'Thijs', 'Joost', 'Wessel', 'Koen', 'Niels', 'Mats', 'Rick', 'Tijn', 'Jesse', 'Sem', 'Floris', 'Gijs', 'Teun'],
    last: ['de Jong', 'van Dijk', 'Bakker', 'Visser', 'Smit', 'Meijer', 'de Vries', 'van den Berg', 'Dekker', 'Mulder', 'Bos', 'Vos', 'Peters', 'Hendriks', 'van Leeuwen', 'Timmermans', 'Kuiper', 'Willems', 'Scholten', 'Brouwer'],
  },
  {
    code: 'POR',
    label: 'Portugal',
    mononymChance: 0.35,
    first: ['Joao', 'Diogo', 'Ruben', 'Bernardo', 'Goncalo', 'Tiago', 'Andre', 'Rafael', 'Nuno', 'Miguel', 'Ricardo', 'Fabio', 'Pedro', 'Hugo', 'Vitor', 'Bruno', 'Daniel', 'Luis', 'Paulo', 'Sergio'],
    last: ['Silva', 'Ferreira', 'Sousa', 'Costa', 'Pinto', 'Carvalho', 'Lopes', 'Mendes', 'Alves', 'Cunha', 'Moura', 'Nunes', 'Tavares', 'Rocha', 'Marques', 'Antunes', 'Freitas', 'Guedes', 'Neves', 'Pires'],
    mononyms: ['Nani', 'Pepe', 'Quaresma', 'Vitinha', 'Chiquinho', 'Zeca', 'Rafa', 'Toze'],
  },
  {
    code: 'JPN',
    label: 'Japan',
    mononymChance: 0,
    first: ['Takumi', 'Sho', 'Ryo', 'Daichi', 'Kaoru', 'Yuto', 'Hiroki', 'Kenta', 'Sota', 'Riku', 'Haruto', 'Yuki', 'Kaito', 'Ren', 'Shota', 'Koki', 'Naoki', 'Tatsuya', 'Yusuke', 'Junya'],
    last: ['Tanaka', 'Suzuki', 'Sato', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Sasaki', 'Yamaguchi', 'Matsumoto', 'Inoue', 'Kimura', 'Hayashi', 'Shimizu', 'Mori', 'Ikeda', 'Hashimoto'],
  },
] as const;

export const NAME_POOL_BY_CODE = new Map(NAME_POOLS.map((p) => [p.code, p]));

export interface GeneratedName {
  firstName: string;
  lastName: string;
  displayName: string;
}

export function generateName(rng: Rng, pool: NamePool): GeneratedName {
  const firstName = rng.pick(pool.first);
  const lastName = rng.pick(pool.last);

  if (pool.mononyms && pool.mononyms.length > 0 && rng.chance(pool.mononymChance)) {
    const mononym = rng.pick(pool.mononyms);
    return { firstName, lastName, displayName: mononym };
  }

  return {
    firstName,
    lastName,
    displayName: `${firstName.charAt(0)}. ${lastName}`,
  };
}
