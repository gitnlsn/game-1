import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card } from './ui';
import { colors, spacing } from '../theme';

/**
 * Catches a render crash so one bad screen does not white-screen the game.
 *
 * The recovery action is deliberately "reload from the last save" rather than
 * "carry on": the engine mutates its world in place, so a crash part-way through
 * a round leaves that world half-updated, and continuing from it would quietly
 * corrupt the career.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; onReload?: () => void },
  { error: Error | undefined }
> {
  override state: { error: Error | undefined } = { error: undefined };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.warn('Screen crashed', error);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Card>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.message}>
              The game hit an error it could not recover from in place. Reloading from your last
              save is safe; carrying on from here would not be.
            </Text>
            <Text style={styles.detail} numberOfLines={6}>
              {error.message}
            </Text>
            <Button
              label="Reload from last save"
              onPress={() => {
                this.setState({ error: undefined });
                this.props.onReload?.();
              }}
              style={styles.action}
            />
          </Card>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingTop: spacing.xl * 2 },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  message: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  detail: {
    color: colors.faint,
    fontSize: 11,
    marginTop: spacing.md,
    fontFamily: 'monospace' as const,
  },
  action: { marginTop: spacing.lg },
});
