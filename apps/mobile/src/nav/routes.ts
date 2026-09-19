/**
 * Route params carry **ids, never objects**. The engine mutates its world in
 * place, so a `Player` or `MatchResult` captured as a param goes stale the
 * moment anything happens; reading it back out of the career on each render does
 * not.
 *
 * There are two screen sets and **only one is mounted at a time**: the menu
 * before a career is entered, the game after. Which one is live is a piece of
 * state in `GameContext` (`started`) -- never a `navigate` call, because there
 * is no route to navigate to until the other set mounts.
 *
 * Their names are disjoint on purpose. React Navigation drops routes whose
 * names disappear when the set changes, so a name in both sets would survive
 * the swap: leaving the game from the in-game Settings screen would land you on
 * a `settings` route inside the menu stack with nothing underneath it. Hence
 * `menuSettings`, which looks redundant and is not.
 */
export type GameStackParamList = {
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

export type MenuStackParamList = {
  title: undefined;
  newCareer: undefined;
  menuSettings: undefined;
};

export type RootStackParamList = GameStackParamList & MenuStackParamList;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
