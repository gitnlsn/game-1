import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card } from '../components/ui';
import { colors, spacing } from '../theme';
import { useGame } from '../game/GameContext';

const EXPLANATION = {
  too_new: 'This save was made by a newer version of the game. Update the app and it should open.',
  no_migration_path:
    'This save was made by a version too old to upgrade automatically.',
  damaged: 'This save could not be read. It may have been interrupted while writing.',
} as const;

/**
 * Shown instead of silently deleting a career. The save itself has been moved
 * aside rather than destroyed, so a future build can still rescue it.
 */
export function SaveProblemScreen() {
  const { saveProblem, dismissSaveProblem } = useGame();
  // No navigator header here: this screen owns its own edge-to-edge insets.
  const insets = useSafeAreaInsets();
  if (!saveProblem) return null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: spacing.xl * 2 + insets.top, paddingBottom: spacing.lg + insets.bottom },
      ]}
    >
      <Text style={styles.title}>Your save could not be opened</Text>
      <Card style={styles.card}>
        <Text style={styles.message}>{EXPLANATION[saveProblem.kind]}</Text>
        <Text style={styles.detail}>{saveProblem.message}</Text>
        <Text style={styles.reassure}>
          It has been kept aside rather than deleted, so a later version may still be able to read
          it.
        </Text>
        {/* The title screen, not the club picker: with the save quarantined
          * there is no career, so it will offer starting one and nothing else. */}
        <Button label="Go to the main menu" onPress={dismissSaveProblem} style={styles.action} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingTop: spacing.xl * 2 },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: spacing.md },
  card: {},
  message: { color: colors.text, fontSize: 14, lineHeight: 20 },
  detail: { color: colors.faint, fontSize: 12, marginTop: spacing.sm, fontStyle: 'italic' },
  reassure: { color: colors.muted, fontSize: 12, marginTop: spacing.md, lineHeight: 18 },
  action: { marginTop: spacing.lg },
});
