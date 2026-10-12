// Adds what app.json can't express statically. Expo passes app.json in as `config`.
const fs = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  // Firebase config for push notifications. Not in git: CI writes it from the
  // GOOGLE_SERVICES_JSON secret (see .github/workflows/android-dev-build.yml). Without it the
  // app still builds and works; it just can't receive push notifications.
  const googleServices = path.join(__dirname, 'google-services.json');
  if (fs.existsSync(googleServices)) {
    config.android = { ...config.android, googleServicesFile: './google-services.json' };
  }
  return config;
};
