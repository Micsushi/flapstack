/**
 * Disabled compatibility proxy for the hosted web backend inherited from the
 * source app. Flapstack is local-first, so remote tRPC calls fail fast without
 * importing web-server types or opening network connections.
 */

function disabledRemoteCall(): never {
  throw new Error("Hosted backend features are disabled in Flapstack")
}

function makeDisabledProxy(): any {
  return new Proxy(disabledRemoteCall, {
    get: () => makeDisabledProxy(),
    apply: () => disabledRemoteCall(),
  })
}

export const remoteTrpc = makeDisabledProxy()
