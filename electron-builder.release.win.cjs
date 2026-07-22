const packageJson = require("./package.json")

module.exports = {
  ...packageJson.build,
  forceCodeSigning: true,
  artifactName: "${productName}-${version}-${arch}.${ext}",
  win: {
    ...packageJson.build.win,
    signAndEditExecutable: true,
    verifyUpdateCodeSignature: true,
  },
}
