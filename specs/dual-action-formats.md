# Spec: Expose GHA actions as both composite actions and reusable workflows

## Context

discord-agent currently provides composite actions (`actions/{deploy-app,deploy-worker,update-archive}/action.yml`) for downstream repos to call. These work well but have a limitation: composite actions can only be referenced from a remote repo (`uses: Open-Athena/discord-agent/actions/...@ref`), not from a local path or submodule.

Reusable workflows (`workflow_call`) support local paths (`uses: ./.github/workflows/foo.yml`), which means a downstream repo could vendor discord-agent as a git submodule and reference its workflows locally — keeping the dependency pinned to a specific SHA without relying on a remote tag.

## Proposal

Expose both formats so downstream repos can choose:

### Option A: Remote composite actions (current)
```yaml
- uses: Open-Athena/discord-agent/actions/deploy-app@v1
  with:
    pages_project_name: marin-discord
    ...
```

### Option B: Local reusable workflows (new)
```yaml
# With discord-agent as a submodule at ./discord-agent/
jobs:
  deploy:
    uses: ./.github/workflows/discord-agent-deploy-app.yml  # thin wrapper
    # or if GH supports it directly:
    uses: ./discord-agent/.github/workflows/deploy-app.yml
```

## What to do

Add reusable workflows (`.github/workflows/{deploy-app,deploy-worker,update-archive}-reusable.yml`) that mirror the composite actions:

- Trigger: `workflow_call` with the same inputs/secrets as the composite actions
- Each workflow is a single job that runs the same steps as the corresponding composite action
- The existing composite actions remain unchanged (no breaking changes)

### Naming

Use a `-reusable` suffix (or similar) to distinguish from the non-reusable dispatch/push-triggered workflows:
- `deploy-app.yml` — push/dispatch triggered (existing)
- `deploy-app-reusable.yml` — `workflow_call` triggered (new)

### Caveats to document

- Reusable workflows run as a separate job (not inline steps), so they can't share state with other steps in the caller's job
- `workflow_call` workflows from submodule paths: verify this actually works with GitHub Actions (it may require the workflow to be in the caller's `.github/workflows/` directory, in which case downstream repos would need thin wrapper workflows that call into the submodule — document this pattern)
- Secrets must be passed explicitly (or use `secrets: inherit`)

## Acceptance criteria

- Three new `*-reusable.yml` workflows with `workflow_call` triggers
- Inputs/secrets match the composite action interfaces
- Document both usage patterns in README
- Existing composite actions unchanged
