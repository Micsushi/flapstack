const packageJson = require("./package.json")

module.exports = {
  ...packageJson.build,
  forceCodeSigning: false,
  artifactName: "${productName}-${version}-${arch}.${ext}",
  mac: {
    ...packageJson.build.mac,
    identity: null,
    notarize: false,
    target: [
      {
        target: "dmg",
        arch: ["arm64", "x64"],
      },
    ],
  },
}
