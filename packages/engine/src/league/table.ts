import type { Club, MatchResult, TableRow } from '../types.js';

export function buildTable(clubs: readonly Club[], results: readonly MatchResult[]): TableRow[] {
  const rows = new Map<string, TableRow>();
  for (const club of clubs) {
    rows.set(club.id, {
      clubId: club.id,
      clubName: club.name,
      played: 0, won: 0, drawn: 0, lost: 0,
      goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0,
    });
  }

  for (const result of results) {
    const home = rows.get(result.homeClubId);
    const away = rows.get(result.awayClubId);
    if (!home || !away) continue;

    home.played++; away.played++;
    home.goalsFor += result.home.goals;
    home.goalsAgainst += result.away.goals;
    away.goalsFor += result.away.goals;
    away.goalsAgainst += result.home.goals;

    if (result.home.goals > result.away.goals) {
      home.won++; home.points += 3; away.lost++;
    } else if (result.home.goals < result.away.goals) {
      away.won++; away.points += 3; home.lost++;
    } else {
      home.drawn++; home.points++; away.drawn++; away.points++;
    }
  }

  for (const row of rows.values()) {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
  }

  return sortTable([...rows.values()]);
}

/** Points, then goal difference, then goals scored, then name. */
export function sortTable(rows: TableRow[]): TableRow[] {
  return rows.sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.clubName.localeCompare(b.clubName),
  );
}
