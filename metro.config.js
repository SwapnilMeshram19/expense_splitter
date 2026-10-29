const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.sourceExts.push('sql');

// web/ is the browser app (Vite, its own node_modules with a second React): never part of the
// Android bundle.
const webDir = path.join(__dirname, 'web').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const existing = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  new RegExp(`^${webDir}[\\/\\\\].*`),
];

module.exports = config;
