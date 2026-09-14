import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ClubScreen } from './ClubScreen';
import { SquadScreen } from './SquadScreen';
import { TableScreen } from './TableScreen';
import { FinancesScreen } from './FinancesScreen';
import { colors } from '../theme';

type TabKey = 'club' | 'squad' | 'table' | 'finances';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'club', label: 'Club', icon: '⚑' },
  { key: 'squad', label: 'Squad', icon: '👥' },
  { key: 'table', label: 'Table', icon: '≡' },
  { key: 'finances', label: 'Money', icon: '◈' },
];

export function TabsScreen() {
  const [tab, setTab] = useState<TabKey>('club');

  return (
    <View style={styles.root}>
      <View style={styles.screen}>
        {tab === 'club' ? (
          <ClubScreen />
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1 },
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
