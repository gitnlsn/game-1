const playGames = require('./playgames.json');

/**
 * `app.json` is still the app's configuration. This file exists only to add the
 * Play Games plugin, and only once there is something to add it *for*.
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
module.exports = ({ config }) => {
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
