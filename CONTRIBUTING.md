# Contributing to mucode

## Before You Start

- Read the [README](./README.md) for setup and provider requirements.
- Open an issue or start a discussion before large changes.
- Keep pull requests narrow and reviewable.

## Development Setup

```bash
git clone https://github.com/sreeragh-s/mucode.git
cd mucode
bun install
```

Run the development overlay:

```bash
bun run dev
```

Run the main app entrypoint:

```bash
bun run start
```

Validate types before opening a PR:

```bash
bun run typecheck
```

## Contribution Areas

Good contribution targets:

- TUI usability and layout polish
- Provider detection and model metadata
- Session rendering and tool trace quality
- Persistence and migration safety
- Documentation and onboarding
- Landing page improvements

## Workflow

1. Create a branch from `main`.
2. Make one focused change.
3. Run `bun run typecheck`.
4. Update docs when behavior or setup changes.
5. Open a pull request with a clear description and screenshots or terminal captures when UI behavior changes.

## Style Expectations

- Prefer small, explicit changes over broad rewrites.
- Preserve existing naming and file organization unless there is a strong reason to change it.
- Keep terminal UX compact and readable.
- Avoid adding dependencies without a clear need.
- Document new environment variables, scripts, or installation steps.

## Pull Request Notes

Please include:

- What changed
- Why it changed
- How you verified it
- Any follow-up work or known limitations

## Reporting Bugs

Bug reports are more useful with:

- Your OS and shell
- Bun version
- Provider used
- Reproduction steps
- Expected behavior
- Actual behavior
- Screenshots or transcript snippets when relevant

## Questions

If a change touches provider behavior, persistence, or session format, ask before making incompatible changes.
