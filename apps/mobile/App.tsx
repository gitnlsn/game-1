import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DarkTheme, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { GameProvider, useGame } from './src/game/GameContext';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { TabsScreen } from './src/screens/TabsScreen';
import { PlayerScreen } from './src/screens/PlayerScreen';
import { TeamSelectionScreen } from './src/screens/TeamSelectionScreen';
import { MatchScreen } from './src/screens/MatchScreen';
import { SeasonSummaryScreen } from './src/screens/SeasonSummaryScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TransfersScreen } from './src/screens/TransfersScreen';
import { NewCareerScreen } from './src/screens/NewCareerScreen';
import { SaveProblemScreen } from './src/screens/SaveProblemScreen';
import { SackedScreen } from './src/screens/SackedScreen';
import { LiveMatchScreen } from './src/screens/LiveMatchScreen';
import type { RootStackParamList } from './src/nav/routes';
import { colors } from './src/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.accent,
  },
};

function Game() {
  const { career, loading, saveProblem } = useGame();

  if (loading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.splashText}>Loading career…</Text>
      </View>
    );
  }

  // A save that could not be read is explained, not silently discarded.
  if (saveProblem) return <SaveProblemScreen />;
  if (!career) return <NewCareerScreen />;

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontSize: 16, fontWeight: '700' },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="tabs" component={TabsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="player" component={PlayerScreen} options={{ title: 'Player' }} />
      <Stack.Screen
        name="teamSelection"
        component={TeamSelectionScreen}
        options={{ title: 'Team selection' }}
      />
      <Stack.Screen name="matchResult" component={MatchScreen} options={{ title: 'Result' }} />
      {/* No going back mid-match: the rest of the round has already been played. */}
      <Stack.Screen
        name="liveMatch"
        component={LiveMatchScreen}
        options={{ title: 'Live', headerBackVisible: false, gestureEnabled: false }}
      />
      <Stack.Screen
        name="seasonSummary"
        component={SeasonSummaryScreen}
        options={{ title: 'Season review', headerBackVisible: false }}
      />
      <Stack.Screen
        name="transfers"
        component={TransfersScreen}
        options={{ title: 'Transfer window' }}
      />
      <Stack.Screen name="settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      {/* No way back: the career is over, and the only move is to start another. */}
      <Stack.Screen
        name="sacked"
        component={SackedScreen}
        options={{ title: 'Dismissed', headerBackVisible: false, gestureEnabled: false }}
      />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <GameProvider>
        <ErrorBoundary onReload={() => { /* the provider reloads from storage on remount */ }}>
          <NavigationContainer theme={navTheme}>
            <Game />
          </NavigationContainer>
        </ErrorBoundary>
      </GameProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  splashText: { color: colors.muted, fontSize: 13, marginTop: 12 },
});
