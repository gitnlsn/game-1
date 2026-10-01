const { withGradleProperties } = require('expo/config-plugins');
const playGames = require('./playgames.json');

/**
 * AsyncStorage on Android is one SQLite file capped at 6 MB unless told
 * otherwise. A save runs to about 1.4 MB after twenty seasons, and Pro keeps
 * three of them -- plus a quarantined copy if one is ever unreadable -- which is
 * too close to that cap for a write failure to be someone's lost career.
 */
const ASYNC_STORAGE_MB = '64';

function withAsyncStorageSize(config) {
  return withGradleProperties(config, (mod) => {
    mod.modResults = mod.modResults.filter(
      (item) => !(item.type === 'property' && item.key === 'AsyncStorage_db_size_in_MB'),
    );
    mod.modResults.push({ type: 'property', key: 'AsyncStorage_db_size_in_MB', value: ASYNC_STORAGE_MB });
    return mod;
  });
}

/**
 * `app.json` is still the app's configuration. This file exists to raise the
 * storage cap above, and to add the Play Games plugin only once there is
 * something to add it *for*.
 *
 * The plugin throws unless it is handed a numeric Play Games application id, so
 * wiring it in unconditionally would break every build -- including web and the
 * dev client, which have nothing to do with Play Games -- until someone pasted
 * an id in. Keying it off the id instead means an unconfigured checkout builds
 * exactly as it did before and the leaderboards are simply inert.
 *
 * iOS is switched off deliberately rather than by omission: the module ships a
 * Game Center half, and enabling it would put a `com.apple.developer.game-center`
 * entitlement on a build that never calls it.
 */
module.exports = ({ config: base }) => {
  const config = withAsyncStorageSize(base);
  if (!/^\d+$/.test(playGames.appId)) return config;

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      [
        '@tubinex/expo-game-services',
        { ios: { enabled: false }, android: { playGamesAppId: playGames.appId } },
      ],
    ],
  };
};
