# Spec: `summarize.py` should support Anthropic API key, not just `claude` CLI

## Problem

`summarize.py` shelled out to the `claude` CLI to call the LLM. This
doesn't work on GitHub Actions runners because `claude` is not
installed and OAuth-based auth would be tricky.

## Implementation

`generate_summary()` now branches on `ANTHROPIC_API_KEY`:

- If set: call `anthropic.Anthropic().messages.create(...)` with a
  `system` parameter (separate from the user message). Model defaults
  to `claude-opus-4-6`, override via `ANTHROPIC_MODEL` env var.
- Otherwise: existing `claude -p --output-format text` subprocess.

`anthropic` added to the inline `# /// script` dependencies block.

## GHA consumer

`weekly-summary.yml` passes `ANTHROPIC_API_KEY` as an env var on the
generate step. Consumer repo (`marin-discord`) provides the secret.

The "skip if files exist" guard remains so reruns don't re-bill the
API for already-generated weeks.
