const packageJson = require("./package.json")

module.exports = {
  ...packageJson.build,
  forceCodeSigning: true,
  nsis: {
    ...packageJson.build.nsis,
    artifactName: "${productName}-Setup-${version}-${arch}.${ext}",
  },
  portable: {
    artifactName: "${productName}-Portable-${version}-${arch}.${ext}",
  },
  win: {
    ...packageJson.build.win,
    signAndEditExecutable: true,
    signExts: [".exe"],
    signtoolOptions: {
      signingHashAlgorithms: ["sha256"],
      rfc3161TimeStampServer: "http://timestamp.digicert.com",
    },
    verifyUpdateCodeSignature: true,
  },
}
