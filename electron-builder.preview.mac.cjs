const packageJson = require("./package.json")

module.exports = {
  ...packageJson.build,
  appId: "dev.flapstack.app.preview",
  productName: "Flapstack Preview",
  // Rebuild per target architecture. A host-only prebuild would package arm64
  // native modules into an x64 Preview when cross-packaging on Apple Silicon.
  npmRebuild: true,
  protocols: [
    {
      name: "Flapstack Preview",
      schemes: ["flapstack-preview"],
    },
  ],
  directories: {
    ...packageJson.build.directories,
    output: "release-preview",
  },
}
