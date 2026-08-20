export function nativeAbiMarker({
  target,
  nodeAbi,
  electronVersion,
  nativeModuleVersions,
  nodeHeaderTarget,
}) {
  const modules = Object.entries(nativeModuleVersions)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, version]) => `${name}@${version}`)
    .join(",")
  // The Node header revision is part of the ABI contract for ObjectWrap addons,
  // so a binary built against different headers must not pass as verified.
  return target === "node"
    ? `node-${nodeAbi}-h${nodeHeaderTarget || "runtime"}-${modules}`
    : `electron-${electronVersion || "unknown"}-${modules}`
}
