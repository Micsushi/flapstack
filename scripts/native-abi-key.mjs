export function nativeAbiMarker({ target, nodeAbi, electronVersion, nativeModuleVersions }) {
  const modules = Object.entries(nativeModuleVersions)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, version]) => `${name}@${version}`)
    .join(",")
  return target === "node"
    ? `node-${nodeAbi}-${modules}`
    : `electron-${electronVersion || "unknown"}-${modules}`
}
