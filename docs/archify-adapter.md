# Archify validation adapter

Flapstack provides an opt-in operator CLI for checking Archify diagram JSON:

```powershell
$env:FLAPSTACK_ARCHIFY_CLI = 'C:\path\to\archify\archify\bin\archify.mjs'
npm run archify:validate -- architecture path/to/diagram.json
```

On macOS/Linux, set the same environment variable to the absolute installed CLI
path. The npm command runs from the Flapstack checkout. To validate another
workspace, run `node /absolute/path/to/flapstack/scripts/archify-validate.mjs KIND
INPUT.json` from that workspace. The input must resolve inside the selected
workspace, be a regular file, and be at most 2 MiB. Supported kinds are
`architecture`, `workflow`, `sequence`, `dataflow`, and `lifecycle`.

The adapter invokes Node directly, without a shell, downloads, installation,
model calls, `--open`, or inherited provider credentials. It limits combined
output to 1 MiB and execution to 30 seconds, with process termination on timeout
or cancellation. A receipt must match the requested command, input and kind;
success additionally requires a successful exit, passing artifact checks, and
zero composition errors. Valid failure receipts remain available as JSON.

The CLI path is explicitly trusted local code. Input confinement and environment
filtering are not an OS sandbox. Archify performs its normal temporary rendering
and cleanup. Do not point this adapter at an untrusted script or treat it as
permission to operate on another workspace.

Compatibility was verified against Archify 2.16.0, repository revision
`5de7275fe87a66a19d52a4d9b0b3a4f2a5a90115`, using its real architecture example.
Archify is MIT licensed; no upstream implementation is copied or bundled.

This is a validation-only operator adapter, not an advertised desktop or agent
tool. Delivery, artifact import, permissioned UI, and isolated HTML preview remain
separate work. Existing Flapstack browser permissions are unchanged.
