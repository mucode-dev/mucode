# mucode

`mucode` is an open source terminal AI coding workspace for running multiple coding agents from one focused TUI.

It gives you one local interface for:

- Codex
- Claude Code
- OpenCode
- `pi-ai` backed API providers

The project is built with Bun, React, and OpenTUI.

## What It Does

- Runs coding agents from a single terminal UI.
- Keeps project-local sessions and transcripts.
- Persists app state locally between runs.
- Lets you switch provider, model, mode, and options from the prompt.
- Surfaces tool output, diffs, code blocks, and work blocks inside the session view.

## Status

`mucode` is usable, but still early. Expect active changes in UI, provider support, and contributor workflow.

## Requirements

- Bun
- Git
- At least one supported provider configured

Platform providers:

- `codex` CLI on your `PATH`
- `claude` CLI on your `PATH`
- `opencode` CLI on your `PATH`

API providers:

- Any provider supported by `@earendil-works/pi-ai`
- The matching API key environment variable for that provider

## Installation

Installer:

```bash
curl -fsSL https://raw.githubusercontent.com/sreeragh-s/mucode/main/install.sh | bash
```

The installer:

- Clones the repo into `~/.mucode` by default
- Runs `bun install`
- Creates a launcher at `~/.local/bin/mucode`

If `~/.local/bin` is not on your `PATH`, add it before using the launcher globally.

## Run From Source

```bash
git clone https://github.com/sreeragh-s/mucode.git
cd mucode
bun install
bun run dev
```

For the normal app entrypoint:

```bash
bun run start
```

## Provider Setup

`mucode` discovers providers locally at runtime.

### Codex

- Install the `codex` CLI
- Ensure it is available on your `PATH`

### Claude Code

- Install the `claude` CLI
- Ensure it is available on your `PATH`

### OpenCode

- Install the `opencode` CLI
- Ensure it is available on your `PATH`

### pi-ai Providers

- Export the relevant provider API key in your shell environment
- Start `mucode`
- Use the provider picker to choose a `pi:*` provider

The UI marks providers as ready, disabled, or not configured based on what it finds locally.

## Local Data

`mucode` stores local state here:

- Settings: `~/.config/mucode/mucode.json`
- Session database: `~/.local/share/mucode/mucode.db`

The landing page is a static root `index.html` file and can be served directly from GitHub Pages.

## Development

Install dependencies:

```bash
bun install
```

Start the dev overlay:

```bash
bun run dev
```

Start the app directly:

```bash
bun run start
```

Run type checking:

```bash
bun run typecheck
```

## Project Layout

```text
src/
  components/     UI panels and status components
  ui/             formatting, picker, transcript, and display helpers
  pi-harness/     agent harness and pi-ai integration
  App.tsx         main TUI app
  provider.ts     provider discovery and model metadata
  session.ts      session execution and provider routing
  storage.ts      local persistence
index.html        static landing page
install.sh        installer
dev.tsx           dev overlay entrypoint
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Code Of Conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Security

See [SECURITY.md](./SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).
