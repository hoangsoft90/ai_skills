// pin-gradle-dependency.js
//
// Expo config plugin template: pin a transitive Gradle dependency to a specific
// version in the generated android project.
//
// Why: some native modules resolve a transitive dependency compiled with a newer
// Kotlin metadata than the RN default compiler can read, e.g.:
//
//   react-native-google-mobile-ads@16.4.0  ->  play-services-ads:25.4.0
//                                             (Kotlin 2.3 metadata, needs Kotlin 2.1)
//   Module was compiled with an incompatible version of Kotlin.
//   The binary version of its metadata is 2.3.0, expected version is 2.1.0.
//
// Bumping Kotlin is NOT a safe fix (see skill references/troubleshooting.md).
// Pinning the transitive dependency DOWN is.
//
// Usage:
//   1. Copy this file to <project>/plugins/pin-gradle-dependency.js
//   2. Set DEPENDENCY / VERSION below (or export from app.json config).
//   3. Register in app.json:
//      "plugins": [ ["./plugins/pin-gradle-dependency", { "dependency": "com.google.android.gms:play-services-ads", "version": "24.2.0" }] ]
//   4. Commit + push; prebuild applies the rule every CI run.

const { withProjectBuildGradle } = require('@expo/config-plugins');

const DEFAULT_DEPENDENCY = 'com.google.android.gms:play-services-ads';
const DEFAULT_VERSION = '24.2.0';

function gradleBlock(dependency, version) {
  return `

// --- Pin ${dependency} (added by pin-gradle-dependency) ---
// Resolve version conflicts between a transitive native dependency and the
// RN-default Kotlin compiler. Survives 'expo prebuild --clean' because this
// plugin re-appends it on every generate.
subprojects {
  configurations.configureEach {
    resolutionStrategy.force '${dependency}:${version}'
  }
}
`;
}

module.exports = function withPinGradleDependency(config) {
  const { dependency = DEFAULT_DEPENDENCY, version = DEFAULT_VERSION } =
    config.plugins?.find((p) => Array.isArray(p) && String(p[0]).endsWith('pin-gradle-dependency'))?.[1] || {};

  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') return config;
    if (config.modResults.contents.includes('pin-gradle-dependency')) return config;
    config.modResults.contents += gradleBlock(dependency, version);
    return config;
  });
};
