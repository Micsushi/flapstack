# OmniRoute catalog adapter

Flapstack's opt-in operator adapter reads the live OmniRoute model catalog:

```powershell
$env:FLAPSTACK_OMNIROUTE_URL = 'http://127.0.0.1:20128'
# Set FLAPSTACK_OMNIROUTE_API_KEY separately if this instance requires a key.
npm run omniroute:models
```

Use equivalent environment variables on macOS/Linux. The URL is required; no
shared service is discovered or contacted automatically. Remote endpoints must
use HTTPS. HTTP is allowed only for explicit loopback addresses. Do not put keys
in the URL. Redirects are not followed, and error bodies are not echoed.

The result retains OmniRoute identity, exact model and combo IDs, context length,
and declared nested capabilities. Missing declarations stay absent, not guessed
from model names. Duplicate IDs, incompatible shapes, responses over 2 MiB, and
requests over ten seconds fail visibly. Unrecognized response fields are stripped;
a credential reflected in a declared field is rejected instead of printed.
There is no cache that could mix accounts or endpoints.

The contract is based on the local OmniRoute repository at
`d9526cefeaea1f4836a947f4a56944fdaf4e8370`, particularly its live OpenCode plugin
and `/v1/models` model shape. OmniRoute is MIT licensed; no upstream code is
copied or bundled. Verification uses a real isolated loopback HTTP fixture, not
a credentialed call to a shared gateway.

This is catalog discovery, not full native chat integration. It neither installs
the OpenCode plugin nor changes global configuration. Native runtime registration,
encrypted credential UI, per-model protocol routing, combo enrichment, and run
usage integration remain separate work. OmniRoute is never labeled as NanoGPT.
