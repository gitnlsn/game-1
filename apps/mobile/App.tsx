import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { MatchResult, SeasonSummary } from '@game1/engine';
import { GameProvider, useGame } from './src/game/GameContext';
import { ClubScreen } from './src/screens/ClubScreen';
import { SquadScreen } from './src/screens/SquadScreen';
import { TableScreen } from './src/screens/TableScreen';
import { FinancesScreen } from './src/screens/FinancesScreen';
import { MatchScreen } from './src/screens/MatchScreen';
import { SeasonSummaryScreen } from './src/screens/SeasonSummaryScreen';
import { NewCareerScreen } from './src/screens/NewCareerScreen';
import { colors, spacing } from './src/theme';

type TabKey = 'club' | 'squad' | 'table' | 'finances';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'club', label: 'Club', icon: '⚑' },
  { key: 'squad', label: 'Squad', icon: '👥' },
  { key: 'table', label: 'Table', icon: '≡' },
  { key: 'finances', label: 'Money', icon: '◈' },
];

function Game() {
  const { career, loading, playRound, finishSeason } = useGame();
  const [tab, setTab] = useState<TabKey>('club');
  const [matchResult, setMatchResult] = useState<MatchResult | undefined>();
  const [summary, setSummary] = useState<SeasonSummary | undefined>();

  if (loading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.splashText}>Loading career…</Text>
      </View>
    );
  }

  if (!career) return <NewCareerScreen />;

  const handlePlay = () => {
    const outcome = playRound();
    if (outcome?.ownMatch) setMatchResult(outcome.ownMatch);
  };

  // The season-end button lives on the club screen; wrap it so the summary shows.
  const handleFinishSeason = () => {
    const result = finishSeason();
    if (result) setSummary(result);
  };

  return (
    <View style={styles.root}>
      <View style={styles.screen}>
        {tab === 'club' ? (
          <ClubScreen onPlay={handlePlay} onFinishSeason={handleFinishSeason} />
        ) : tab === 'squad' ? (
          <SquadScreen />
        ) : tab === 'table' ? (
          <TableScreen />
        ) : (
          <FinancesScreen />
        )}
      </View>

      <View style={styles.tabBar}>
        {TABS.map((item) => {
          const active = item.key === tab;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              style={styles.tab}
            >
              <Text style={[styles.tabIcon, active ? styles.tabIconActive : null]}>{item.icon}</Text>
              <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {matchResult ? (
        <MatchScreen
          career={career}
          result={matchResult}
          onDismiss={() => setMatchResult(undefined)}
        />
      ) : null}

      {summary ? (
        <SeasonSummaryScreen
          career={career}
          summary={summary}
          onDismiss={() => setSummary(undefined)}
        />
      ) : null}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <GameProvider>
          <Game />
        </GameProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  root: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1 },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  splashText: { color: colors.muted, fontSize: 13, marginTop: spacing.md },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingTop: 6,
    paddingBottom: 6,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  tabIcon: { fontSize: 17, color: colors.faint },
  tabIconActive: { color: colors.accent },
  tabLabel: { fontSize: 10, color: colors.faint, fontWeight: '600', marginTop: 2 },
  tabLabelActive: { color: colors.accent },
});
