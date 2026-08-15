const { withProjectBuildGradle } = require('expo/config-plugins');

/**
 * Pins the Android toolchain to what Unity's bundled SDK provides.
 *
 * This machine has no Android Studio; the SDK comes from Unity, which ships
 * NDK 27.2.12479018 and build-tools 36.0.0. Expo defaults to NDK 27.1 and some
 * modules default to build-tools 35, neither of which is installed — and
 * Gradle can't fetch them because that needs an interactive licence prompt.
 *
 * Both settings must be injected ABOVE the `apply plugin` lines:
 *   - ExpoRootProjectPlugin uses setIfNotExist for ndkVersion, so a later
 *     assignment is ignored.
 *   - The React root plugin evaluates :app eagerly, so a subprojects
 *     afterEvaluate block registered afterwards throws "already evaluated".
 *
 * Drop this plugin if a real Android SDK is installed via Android Studio.
 */
const NDK_VERSION = '27.2.12479018';
const BUILD_TOOLS_VERSION = '36.0.0';

const MARKER = '// covered: unity android toolchain';

const INJECTION = `
${MARKER}
ext.ndkVersion = "${NDK_VERSION}"
ext.buildToolsVersion = "${BUILD_TOOLS_VERSION}"

subprojects {
  afterEvaluate { sub ->
    if (sub.plugins.hasPlugin("com.android.application") || sub.plugins.hasPlugin("com.android.library")) {
      sub.android {
        buildToolsVersion = "${BUILD_TOOLS_VERSION}"
      }
    }
  }
}
`;

module.exports = function withUnityAndroidSdk(config) {
  return withProjectBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== 'groovy') return modConfig;
    if (modConfig.modResults.contents.includes(MARKER)) return modConfig;

    const anchor = 'apply plugin: "expo-root-project"';
    if (!modConfig.modResults.contents.includes(anchor)) return modConfig;

    modConfig.modResults.contents = modConfig.modResults.contents.replace(
      anchor,
      `${INJECTION}\n${anchor}`,
    );
    return modConfig;
  });
};
