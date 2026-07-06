# Contributing to Flapstack

## Building from Source

Prerequisites: Bun, Python, Xcode Command Line Tools (macOS)

```bash
bun install
bun run dev      # Development with hot reload
bun run build    # Production build
bun run package:mac  # Create distributable
```

## Project Status

Flapstack is currently a private derivative of the Apache-2.0 licensed 1Code
codebase. The first phase is repo adoption, architecture inspection, and mapping
the inherited app model to Flapstack's project/task/chat model.

Hosted services, sync, background agents, and auto-update infrastructure are
disabled for now. Core development should preserve local-only operation.

## Analytics & Telemetry

Analytics (PostHog) and error tracking (Sentry) are **disabled by default** in open source builds. They only activate if you set the environment variables in `.env.local`.

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Submit a PR

## License

Apache 2.0
