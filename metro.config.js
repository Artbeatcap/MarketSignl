const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(path.resolve(__dirname, 'apps/mobile'));

module.exports = config;
