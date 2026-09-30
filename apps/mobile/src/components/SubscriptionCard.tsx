import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Badge, Button, Card, SectionTitle } from './ui';
import { SubscriptionPlans } from './SubscriptionPlans';
import { colors, spacing } from '../theme';
import { planLabel, useSubscription } from '../game/subscription';

/**
 * Where the player stands with Eleven Deep Pro. Status only: the plans and
 * their prices are one tap further in, in SubscriptionPlans.
 *
 * Draws nothing until billing is configured, so a build without a
 * subscription id looks exactly as it did before.
 */
export function SubscriptionCard() {
  const { available, checking, membership, manage } = useSubscription();
  const [choosing, setChoosing] = useState(false);
  const [welcome, setWelcome] = useState(false);

  if (!available) return null;

  const plan = planLabel(membership?.planId);
  const status = membership
    ? membership.autoRenewing
      ? 'Renews automatically.'
      : 'Cancelled. Pro stays active until the end of the period you paid for.'
    : checking
      ? 'Checking Google Play…'
      : 'You are playing the free version.';

  return (
    <>
      <SectionTitle>Subscription</SectionTitle>
      <Card>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{membership && plan ? `Pro · ${plan}` : membership ? 'Pro' : 'Free'}</Text>
          {membership ? (
            <Badge
              label={membership.autoRenewing ? 'Active' : 'Ending'}
              color={membership.autoRenewing ? colors.accent : colors.warn}
            />
          ) : null}
        </View>
        <Text style={styles.note}>{status}</Text>
        {welcome && membership ? <Text style={styles.welcome}>Welcome to Eleven Deep Pro.</Text> : null}

        {membership ? (
          <Button
            label="Manage subscription"
            variant="secondary"
            onPress={() => void manage()}
            style={styles.action}
          />
        ) : (
          <Button label="See plans" onPress={() => setChoosing(true)} style={styles.action} />
        )}
      </Card>

      <SubscriptionPlans
        visible={choosing}
        onClose={() => setChoosing(false)}
        onSubscribed={() => {
          setChoosing(false);
          setWelcome(true);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  note: { color: colors.muted, fontSize: 12, marginTop: spacing.xs, lineHeight: 17 },
  welcome: { color: colors.accent, fontSize: 12, marginTop: spacing.sm, fontWeight: '600' },
  action: { marginTop: spacing.md },
});
