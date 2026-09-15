/**
 * Route params carry **ids, never objects**. The engine mutates its world in
 * place, so a `Player` or `MatchResult` captured as a param goes stale the
 * moment anything happens; reading it back out of the career on each render does
 * not.
 */
export type RootStackParamList = {
  tabs: undefined;
  player: { playerId: string };
  teamSelection: undefined;
  matchResult: { round: number };
  seasonSummary: undefined;
  transfers: undefined;
  settings: undefined;
  sacked: undefined;
  liveMatch: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
