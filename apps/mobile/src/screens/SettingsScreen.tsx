import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, ChipRow, Divider, ScreenHeader, SectionTitle } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LeaderboardsCard } from '../components/Leaderboards';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { ProButton, usePaywall } from '../components/ProGate';
import { colors, spacing } from '../theme';
import { useGame } from '../game/GameContext';
import { useSubscription } from '../game/subscription';
import { usePro } from '../game/pro';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { GameStackParamList } from '../nav/routes';
import appConfig from '../../app.json';

/**
 * Which build this is, for anyone testing one.
 *
 * Read from app.json rather than through expo-constants: the values live there,
 * EAS bumps `versionCode` there before it builds, and the bundle that ships
 * inside a binary is therefore the one that names it. It is also one fewer
 * dependency for two strings.
 *
 * This would stop being true the day over-the-air updates are switched on,
 * because the JS could then be newer than the binary carrying it. They are off
 * (`expo.modules.updates.ENABLED=false` in the generated manifest), and if they
 * are ever turned on this should move to expo-application, which reads the
 * installed package rather than the bundle.
 */
const BUILD = `${appConfig.expo.version} (${appConfig.expo.android.versionCode})`;

const DEV_PRO = [
  { value: 'play' as const, label: 'Ask Play' },
  { value: 'free' as const, label: 'Free' },
  { value: 'pro' as const, label: 'Pro' },
];

const SELECTION = [
  { value: 'you' as const, label: 'You pick' },
  { value: 'assistant' as const, label: 'Assistant picks' },
];

const MATCH_MODES = [
  { value: 'instant' as const, label: 'Instant' },
  { value: 'replay' as const, label: 'Replay' },
  { value: 'live' as const, label: 'Live' },
];

/**
 * Both the Options tab in-game and the Settings screen off the title menu. The
 * menu reaches it through the navigator, which draws its own header; the tab
 * has none of its own, so it asks for one (`header`) the way every other tab
 * has one.
 */
export function SettingsScreen({ header = false }: { header?: boolean }) {
  const { settings, updateSettings, abandonCareer, career, started, live, returnToTitle, lifetime, slots } =
    useGame();
  const pro = usePro();
  const paywall = usePaywall();
  const navigation = useNavigation<NativeStackNavigationProp<GameStackParamList>>();
  // Another career kept besides this one, which abandoning leaves alone.
  const othersKept = Object.keys(slots.slots).some((slot) => Number(slot) !== slots.active);
  const insets = useSafeAreaInsets();
  const [confirming, setConfirming] = useState(false);
  const subscription = useSubscription();
  const [refreshing, setRefreshing] = useState(false);

  // Pull-to-refresh asks Google Play again, so it only exists where Play does.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await subscription.reload();
    } finally {
      setRefreshing(false);
    }
  }, [subscription]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.lg + insets.bottom }]}
      refreshControl={
        subscription.available ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
          />
        ) : undefined
      }
    >
      {header ? (
        <ScreenHeader
          title="Options"
          subtitle="How matches are played, and what to do with this career."
        />
      ) : null}

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

      {pro.offered ? (
        <>
          <SectionTitle>Team selection</SectionTitle>
          <Card>
            {pro.active ? (
              <>
                <ChipRow
                  options={SELECTION}
                  value={settings.assistantPicks ? 'assistant' : 'you'}
                  onChange={(value) => updateSettings({ assistantPicks: value === 'assistant' })}
                />
                <Text style={styles.note}>
                  {settings.assistantPicks
                    ? 'Before every match your assistant picks the fittest, most in-form eleven in your formation. Your instructions stay as you set them, and anything you pick by hand is replaced at kick-off.'
                    : 'The eleven you pick stays picked until you change it.'}
                </Text>
              </>
            ) : (
              <ProButton
                label="Let your assistant pick the team"
                reason="Before every match, your assistant picks the fittest and most in-form eleven in your formation."
                onLocked={paywall.show}
                onPress={() => {}}
              />
            )}
          </Card>
        </>
      ) : null}

      {/*
        * Above Career on purpose. It is a record rather than a setting, and
        * the section below it ends in a destructive button -- anything placed
        * after that reads as an afterthought and gets scrolled past.
        */}
      {/* Only in a career: there is nothing to rename from the title menu. */}
      {pro.offered && career && started ? (
        <>
          <SectionTitle>Editor</SectionTitle>
          <ProButton
            label="Rename clubs and players"
            reason="Rename any player or club, and the game uses your names everywhere."
            onLocked={paywall.show}
            onPress={() => navigation.navigate('editor')}
          />
        </>
      ) : null}

      <LeaderboardsCard lifetime={lifetime} />

      <SubscriptionCard />

      {/* Reached from the title screen too, where there may be no career to
        * abandon and nothing to go back to. */}
      {career ? (
        <>
          <SectionTitle>Career</SectionTitle>
          <Card>
            {started && !live ? (
              <>
                <Text style={styles.note}>
                  The game saves after every action, so leaving now costs you nothing.
                </Text>
                <Button
                  label="Main menu"
                  variant="secondary"
                  onPress={returnToTitle}
                  style={styles.action}
                />
                <Divider style={styles.divider} />
              </>
            ) : null}
            <Text style={styles.warning}>
              {othersKept
                ? 'Abandoning deletes this career permanently. Your other careers are not affected.'
                : pro.active
                  ? 'Abandoning deletes this career permanently.'
                  : 'Abandoning deletes this career permanently. There is only one save.'}
            </Text>
            <Button
              label="Abandon career"
              variant="danger"
              onPress={() => setConfirming(true)}
              style={styles.action}
            />
          </Card>
        </>
      ) : null}

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

      {__DEV__ ? (
        <>
          <SectionTitle>Development</SectionTitle>
          <Card>
            <ChipRow
              options={DEV_PRO}
              value={settings.devPro ?? 'play'}
              onChange={(value) => updateSettings({ devPro: value === 'play' ? undefined : value })}
            />
            <Text style={styles.note}>
              Pretend to be a free player or a subscriber, to see both sides of Pro without Google Play.
            </Text>
          </Card>
        </>
      ) : null}

      {/*
        * `dev` is the useful half of this. A debug build served by Metro and a
        * release build installed from Play look identical on screen, behave
        * differently, and are signed by different keys -- which is exactly the
        * distinction that is hard to make from the outside.
        */}
      {paywall.element}

      <Text style={styles.build}>
        Eleven Deep {BUILD}
        {__DEV__ ? ' · dev' : ''}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  note: { color: colors.muted, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
  warning: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  action: { marginTop: spacing.md },
  divider: { marginVertical: spacing.md },
  build: {
    color: colors.faint,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.xl,
    fontVariant: ['tabular-nums'],
  },
});
