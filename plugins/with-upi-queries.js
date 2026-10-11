/**
 * Android 11+ package visibility: lets Linking.canOpenURL see installed UPI apps ('upi://pay')
 * and WhatsApp ('whatsapp://send', also WhatsApp Business). Declares only these schemes, not
 * QUERY_ALL_PACKAGES (restricted by Play policy). Linking.openURL works without this; only the
 * "is it installed?" checks depend on it.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const SCHEMES = ['upi', 'whatsapp'];

const viewIntent = (scheme) => ({
  action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
  data: [{ $: { 'android:scheme': scheme } }],
});

module.exports = function withUpiQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.queries = manifest.queries ?? [];
    if (manifest.queries.length === 0) manifest.queries.push({});
    const block = manifest.queries[0];
    block.intent = block.intent ?? [];
    for (const scheme of SCHEMES) {
      const present = block.intent.some((intent) =>
        (intent.data ?? []).some((d) => d.$ && d.$['android:scheme'] === scheme),
      );
      if (!present) block.intent.push(viewIntent(scheme));
    }
    return cfg;
  });
};