const packageJson = require("./package.json")

module.exports = {
  ...packageJson.build,
  appId: "dev.flapstack.app.preview",
  productName: "Flapstack Preview",
  npmRebuild: false,
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
  win: {
    ...packageJson.build.win,
    executableName: "Flapstack Preview",
  },
}
