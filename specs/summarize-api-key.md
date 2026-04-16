# Spec: `summarize.py` should support Anthropic API key, not just `claude` CLI

## Problem

`summarize.py` shells out to the `claude` CLI (line ~272) to call the LLM.
This doesn't work on GitHub Actions runners because `claude` is not
installed and auth would be tricky.

## Fix

Support an alternate path using the Anthropic Python SDK:

```python
def generate_summary(data, week_start, week_end):
    prompt = ...
    if os.environ.get("ANTHROPIC_API_KEY"):
        # API path
        from anthropic import Anthropic
        client = Anthropic()
        response = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=16000,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text
    else:
        # CLI path (existing)
        result = subprocess.run(["claude", "-p", "--output-format", "text"], ...)
        raw = result.stdout.strip()
    ...
```

Add `anthropic` to the script's dependencies block.

## GHA consumer

`weekly-summary.yml` should pass `ANTHROPIC_API_KEY` as an env var:

```yaml
env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Consumer repo (marin-discord) adds the secret.

## Workflow fallback (current)

Until this is implemented, `weekly-summary.yml` has a "generate (if not already present)" step that fails loudly if `summaries/$WEEK/xs.md` is missing. Users pre-generate locally (with `claude` CLI available) and commit before the cron runs.
