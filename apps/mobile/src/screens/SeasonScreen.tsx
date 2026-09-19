import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  divisionTables,
  isSeasonComplete,
  managedLeague,
  transferWindow,
  type Career,
} from '@eleven-deep/engine';
import { ChipRow, ScreenHeader, Segmented } from '../components/ui';
import { colors, spacing } from '../theme';
import { ordinal } from '../format';
import { useGame } from '../game/GameContext';
import { TableScreen } from './TableScreen';
import { CalendarScreen } from './CalendarScreen';

/**
 * The competition, from two angles: where everyone stands, and how the season is
 * laid out. They share a tab because they are the same subject -- the table is
 * the state, the fixtures are the shape.
 *
 * Both selectors live here, on one row. Stacking them cost a whole row of a
 * phone screen, and they are not peers: which view you are looking at is the
 * outer choice, which division is a setting of one of them. So the view sits
 * left where the eye starts, the division sits right, and the division goes away
 * entirely on the fixtures, which are your own club's and belong to no tier.
 */
type SeasonView = 'table' | 'fixtures';

const VIEWS = [
  { value: 'table' as const, label: 'Table' },
  { value: 'fixtures' as const, label: 'Fixtures' },
];

export function SeasonScreen() {
  const { career, version } = useGame();
  const [view, setView] = useState<SeasonView>('table');
  const [tier, setTier] = useState<string | undefined>();

  const divisions = useMemo(() => (career ? divisionTables(career) : []), [career, version]);

  if (!career) return null;

  const shown =
    divisions.find((d) => d.league.id === tier) ??
    divisions.find((d) => d.league.id === managedLeague(career).id) ??
    divisions[0];

  const showTiers = view === 'table' && divisions.length > 1;

  /*
   * The metrics describe the division on screen, not your own -- browsing
   * another tier and being shown your position in a table you are not looking
   * at would be a number attached to nothing. Your own row simply goes to a
   * dash down there.
   */
  const shownTable = shown?.table ?? [];
  const ownIndex = shownTable.findIndex((r) => r.clubId === career.managedClubId);

  return (
    <View style={styles.container}>
      <View style={styles.headerArea}>
        <ScreenHeader
          title="Season"
          subtitle={
            view === 'table'
              ? 'Green is a promotion place, red is the drop.'
              : 'Your matchdays in order, with the transfer window.'
          }
          metrics={[
            { label: 'Matchday', value: matchdayLabel(career) },
            { label: 'Leader', value: shownTable[0]?.clubName ?? '—', name: true },
            { label: 'You', value: ownIndex >= 0 ? ordinal(ownIndex + 1) : '—' },
          ]}
        />
      </View>

      <View style={styles.selectors}>
        <Segmented options={VIEWS} value={view} onChange={setView} />
        {showTiers ? (
          <ChipRow
            options={divisions.map((d) => ({
              value: d.league.id,
              label: `Tier ${d.league.tier}`,
            }))}
            value={shown?.league.id ?? ''}
            onChange={setTier}
          />
        ) : null}
      </View>

      {view === 'table' ? (
        <TableScreen division={shown} divisionCount={divisions.length} />
      ) : (
        <CalendarScreen />
      )}
    </View>
  );
}

/**
 * Reads the same three states the calendar's own progress label used to, before
 * that header was folded into this one: a season still running, one played out,
 * and the window between them.
 */
function matchdayLabel(career: Career): string {
  if (transferWindow(career) !== undefined) return 'Window open';
  if (isSeasonComplete(career)) return 'Complete';
  return `${career.season.nextRound} of ${career.season.totalRounds}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerArea: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  selectors: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    // Wraps rather than overflowing: a pyramid deeper than two divisions puts
    // more chips on the right than a narrow phone can sit beside the view.
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
