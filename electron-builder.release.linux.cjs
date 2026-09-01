const packageJson = require("./package.json")

module.exports = {
  ...packageJson.build,
  artifactName: "${productName}-${version}-${arch}.${ext}",
  deb: {
    ...packageJson.build.deb,
    afterInstall: "build/linux-after-install-release.sh",
  },
}
