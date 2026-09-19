import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ClubScreen } from './ClubScreen';
import { SquadScreen } from './SquadScreen';
import { SeasonScreen } from './SeasonScreen';
import { FinancesScreen } from './FinancesScreen';
import { colors } from '../theme';

type TabKey = 'club' | 'squad' | 'season' | 'finances';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'club', label: 'Club', icon: '⚑' },
  { key: 'squad', label: 'Squad', icon: '👥' },
  { key: 'season', label: 'Season', icon: '≡' },
  { key: 'finances', label: 'Money', icon: '◈' },
];

export function TabsScreen() {
  const [tab, setTab] = useState<TabKey>('club');
  // The app draws edge to edge, so the status bar and the system navigation
  // bar are ours to keep clear of.
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.screen}>
        {tab === 'club' ? (
          <ClubScreen />
        ) : tab === 'squad' ? (
          <SquadScreen />
        ) : tab === 'season' ? (
          <SeasonScreen />
        ) : (
          <FinancesScreen />
        )}
      </View>

      <View style={[styles.tabBar, { paddingBottom: TAB_BAR_PADDING + insets.bottom }]}>
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
    </View>
  );
}

const TAB_BAR_PADDING = 6;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingTop: TAB_BAR_PADDING,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  tabIcon: { fontSize: 17, color: colors.faint },
  tabIconActive: { color: colors.accent },
  tabLabel: { fontSize: 10, color: colors.faint, fontWeight: '600', marginTop: 2 },
  tabLabelActive: { color: colors.accent },
});
