import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, ChipRow, SectionTitle } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { colors, spacing } from '../theme';
import { useGame } from '../game/GameContext';

const MATCH_MODES = [
  { value: 'instant' as const, label: 'Instant' },
  { value: 'replay' as const, label: 'Replay' },
  { value: 'live' as const, label: 'Live' },
];

export function SettingsScreen() {
  const { settings, updateSettings, abandonCareer } = useGame();
  const insets = useSafeAreaInsets();
  const [confirming, setConfirming] = useState(false);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.lg + insets.bottom }]}
    >
      <SectionTitle>Matches</SectionTitle>
      <Card>
        <ChipRow
          options={MATCH_MODES}
          value={settings.matchMode}
          onChange={(matchMode) => updateSettings({ matchMode })}
        />
        <Text style={styles.note}>
          {settings.matchMode === 'live'
            ? 'The match is played as you watch, and you can make substitutions and change your instructions while it runs.'
            : settings.matchMode === 'replay'
              ? 'Goals and cards appear as the clock runs. You can skip at any point.'
              : 'The full result appears straight away.'}
        </Text>
      </Card>

      <SectionTitle>Career</SectionTitle>
      <Card>
        <Text style={styles.warning}>
          Abandoning deletes this career permanently. There is only one save.
        </Text>
        <Button
          label="Abandon career"
          variant="danger"
          onPress={() => setConfirming(true)}
          style={styles.action}
        />
      </Card>

      <ConfirmDialog
        visible={confirming}
        title="Abandon this career?"
        message="Your club, squad and every season you have played will be deleted. This cannot be undone."
        confirmLabel="Abandon"
        destructive
        onConfirm={() => {
          setConfirming(false);
          abandonCareer();
        }}
        onCancel={() => setConfirming(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  note: { color: colors.muted, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
  warning: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  action: { marginTop: spacing.md },
});
