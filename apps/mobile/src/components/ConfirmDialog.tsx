import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Button, Card } from './ui';
import { colors, spacing } from '../theme';

/**
 * A confirmation the player actually sees.
 *
 * Deliberately not `Alert.alert`: in react-native-web that is a function with an
 * empty body, so it works on a device and silently does nothing in a browser --
 * which is where this app is developed and verified. A destructive action that
 * quietly skips its confirmation is worse than no confirmation at all.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop} accessibilityViewIsModal>
        <Card style={styles.card}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <Button label={cancelLabel} onPress={onCancel} variant="secondary" style={styles.action} />
            <Button
              label={confirmLabel}
              onPress={onConfirm}
              variant={destructive ? 'danger' : 'primary'}
              style={styles.action}
            />
          </View>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: { width: '100%', maxWidth: 360 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  message: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  action: { flex: 1 },
});
