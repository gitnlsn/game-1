import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
/*
 * One icon per import, from the deep path. The package's index re-exports
 * every icon lucide has and Metro does not shake the unused ones out, so the
 * barrel import puts some fifteen hundred components in the bundle to draw
 * five. The type is a type-only import and costs nothing.
 */
import ListOrdered from 'lucide-react-native/icons/list-ordered';
import Settings from 'lucide-react-native/icons/settings';
import Shield from 'lucide-react-native/icons/shield';
import Users from 'lucide-react-native/icons/users';
import Wallet from 'lucide-react-native/icons/wallet';
import type { LucideIcon } from 'lucide-react-native';
import { ClubScreen } from './ClubScreen';
import { SquadScreen } from './SquadScreen';
import { SeasonScreen } from './SeasonScreen';
import { FinancesScreen } from './FinancesScreen';
import { SettingsScreen } from './SettingsScreen';
import { colors } from '../theme';

type TabKey = 'club' | 'squad' | 'season' | 'finances' | 'options';

/*
 * One icon set, drawn as line art at one weight, and coloured only by which tab
 * you are on. The glyphs these replace came from different alphabets and two
 * were emoji, which carry their own colour: a blue pair of heads sat next to a
 * grey rune, and the bar read as five unrelated marks rather than one row.
 */
const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'club', label: 'Club', icon: Shield },
  { key: 'squad', label: 'Squad', icon: Users },
  { key: 'season', label: 'Season', icon: ListOrdered },
  { key: 'finances', label: 'Money', icon: Wallet },
  { key: 'options', label: 'Options', icon: Settings },
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
        ) : tab === 'finances' ? (
          <FinancesScreen />
        ) : (
          <SettingsScreen header />
        )}
      </View>

      <View style={[styles.tabBar, { paddingBottom: TAB_BAR_PADDING + insets.bottom }]}>
        {TABS.map((item) => {
          const active = item.key === tab;
          const Icon = item.icon;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              style={styles.tab}
            >
              <Icon size={20} strokeWidth={2} color={active ? colors.accent : colors.faint} />
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
  tabLabel: { fontSize: 10, color: colors.faint, fontWeight: '600', marginTop: 3 },
  tabLabelActive: { color: colors.accent },
});
