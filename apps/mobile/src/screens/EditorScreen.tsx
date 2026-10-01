import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Pencil from 'lucide-react-native/icons/pencil';
import { findClub, renameClub } from '@eleven-deep/engine';
import { SectionTitle } from '../components/ui';
import { RenameDialog } from '../components/RenameDialog';
import { colors, radius, spacing } from '../theme';
import { useGame } from '../game/GameContext';

/**
 * Every club in the world, to rename. Players are renamed from their own
 * screen, where you already are when you want to. Pro, reached from Options.
 */
export function EditorScreen() {
  const { career, refresh } = useGame();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState<string>();
  if (!career) return null;

  const club = editing ? findClub(career.world, editing) : undefined;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}
    >
      <Text style={styles.intro}>
        Rename any club and its town, and the game uses your names everywhere from now on. Past
        seasons keep the names they were played under. To rename a player, open them and use Rename
        player at the bottom.
      </Text>
      {career.world.leagues.map((league) => (
        <View key={league.id}>
          <SectionTitle>{league.name}</SectionTitle>
          <View style={styles.list}>
            {[...league.clubs]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => setEditing(c.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Rename ${c.name}`}
                  style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {c.name}
                      {c.id === career.managedClubId ? <Text style={styles.yours}>  · yours</Text> : null}
                    </Text>
                    <Text style={styles.city}>{c.city}</Text>
                  </View>
                  <Pencil color={colors.muted} size={16} />
                </Pressable>
              ))}
          </View>
        </View>
      ))}

      <RenameDialog
        visible={club !== undefined}
        title="Rename club"
        fields={
          club
            ? [
                { key: 'name', label: 'Club name', value: club.name },
                { key: 'city', label: 'Town', value: club.city },
              ]
            : []
        }
        onSave={(values) => {
          if (!club || !renameClub(career, club.id, { name: values.name ?? '', city: values.city ?? '' })) {
            return false;
          }
          setEditing(undefined);
          refresh();
          return true;
        }}
        onCancel={() => setEditing(undefined)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  intro: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: spacing.sm },
  list: { gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowPressed: { backgroundColor: colors.surfaceAlt, borderColor: colors.borderBright },
  rowText: { flex: 1 },
  name: { color: colors.text, fontSize: 14, fontWeight: '600' },
  yours: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  city: { color: colors.muted, fontSize: 12, marginTop: 1 },
});
