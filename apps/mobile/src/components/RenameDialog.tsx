import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { MAX_NAME_LENGTH } from '@eleven-deep/engine';
import { Button, Card } from './ui';
import { colors, radius, spacing } from '../theme';

export interface RenameField {
  key: string;
  label: string;
  value: string;
}

/**
 * The editor's one dialog: a few named text fields and Save. `onSave` returns
 * false when the engine refuses a name, so the dialog can say so rather than
 * closing as if it had worked.
 */
export function RenameDialog({
  visible,
  title,
  fields,
  onSave,
  onCancel,
}: {
  visible: boolean;
  title: string;
  fields: RenameField[];
  onSave: (values: Record<string, string>) => boolean;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string>();

  // Fresh from the current names each time it opens.
  useEffect(() => {
    if (!visible) return;
    setValues(Object.fromEntries(fields.map((f) => [f.key, f.value])));
    setProblem(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  const save = () => {
    if (onSave(values)) return;
    setProblem(`Names need at least one letter and at most ${MAX_NAME_LENGTH} characters.`);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop} accessibilityViewIsModal>
        <Card style={styles.card}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {fields.map((field) => (
            <View key={field.key} style={styles.field}>
              <Text style={styles.label}>{field.label}</Text>
              <TextInput
                value={values[field.key] ?? ''}
                onChangeText={(text) => setValues((v) => ({ ...v, [field.key]: text }))}
                maxLength={MAX_NAME_LENGTH}
                autoCorrect={false}
                accessibilityLabel={field.label}
                placeholderTextColor={colors.faint}
                selectionColor={colors.accent}
                style={styles.input}
                onSubmitEditing={save}
              />
            </View>
          ))}
          {problem ? <Text style={styles.problem}>{problem}</Text> : null}
          <View style={styles.actions}>
            <Button label="Cancel" onPress={onCancel} variant="secondary" style={styles.action} />
            <Button label="Save" onPress={save} style={styles.action} />
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
  field: { marginTop: spacing.md },
  label: { color: colors.muted, fontSize: 12, marginBottom: spacing.xs },
  input: {
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  problem: { color: colors.warn, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  action: { flex: 1 },
});
