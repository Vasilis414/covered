const { withEntitlementsPlist } = require('expo/config-plugins');

/**
 * Strips the `aps-environment` entitlement that expo-notifications adds.
 *
 * Covered only schedules *local* notifications, which need no entitlement.
 * Keeping it breaks signing on free Apple accounts outright: personal
 * development teams cannot create a provisioning profile for an app that
 * declares the Push Notifications capability.
 *
 * Remove this plugin if remote push is ever added — that needs a paid account.
 */
module.exports = function withNoPushEntitlement(config) {
  return withEntitlementsPlist(config, (modConfig) => {
    delete modConfig.modResults['aps-environment'];
    return modConfig;
  });
};
