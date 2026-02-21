/**
 * withCustomTheme
 *
 * Overwrites android/app/src/main/res/values/colors.xml with ChartSignl brand colors.
 * These values are referenced by the AppTheme in styles.xml.
 */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const COLORS_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="colorPrimary">#023c69</color>
  <color name="colorPrimaryDark">#ffffff</color>
  <color name="splashscreen_background">#F0F9F9</color>
</resources>
`;

function withCustomTheme(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const colorsPath = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "values",
        "colors.xml"
      );

      const dir = path.dirname(colorsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(colorsPath, COLORS_XML);

      return config;
    },
  ]);
}

module.exports = withCustomTheme;
