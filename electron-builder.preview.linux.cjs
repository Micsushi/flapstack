const packageJson = require("./package.json")

module.exports = {
  ...packageJson.build,
  appId: "dev.flapstack.app.preview",
  // electron-builder uses productName as the /opt install directory for deb
  // packages. Chromium's setuid sandbox cannot re-exec an app from a path with
  // spaces on stricter Debian hosts, so keep the Linux package path shell-safe.
  // The runtime still presents "Flapstack Preview" via app.setName().
  productName: "Flapstack-Preview",
  npmRebuild: true,
  extraMetadata: {
    name: "flapstack-preview",
    desktopName: "flapstack-preview.desktop",
  },
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
  linux: {
    ...packageJson.build.linux,
    executableName: "flapstack-preview",
  },
}
