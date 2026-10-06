/**
 * Android 11+ package visibility: lets Linking.canOpenURL('upi://pay') see installed UPI apps.
 * Declares only the upi scheme, not QUERY_ALL_PACKAGES (restricted by Play policy).
 * Linking.openURL works without this; only the "is a UPI app installed?" hint depends on it.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const UPI_INTENT = {
  action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
  data: [{ $: { 'android:scheme': 'upi' } }],
};

module.exports = function withUpiQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.queries = manifest.queries ?? [];
    if (manifest.queries.length === 0) manifest.queries.push({});
    const block = manifest.queries[0];
    block.intent = block.intent ?? [];
    const present = block.intent.some((intent) =>
      (intent.data ?? []).some((d) => d.$ && d.$['android:scheme'] === 'upi'),
    );
    if (!present) block.intent.push(UPI_INTENT);
    return cfg;
  });
};