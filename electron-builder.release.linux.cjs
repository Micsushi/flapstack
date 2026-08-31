const packageJson = require("./package.json")

module.exports = {
  ...packageJson.build,
  artifactName: "${productName}-${version}-${arch}.${ext}",
}
