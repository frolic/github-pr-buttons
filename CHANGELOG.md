# Changelog

## v0.2.0

- No token. The extension now uses your github.com session, the same pages and forms as the Actions tab, so there is nothing to set up. The options page is gone.
- Runs on older commits no longer show their commit.

## v0.1.0

First release.

- A **Workflows** section in the pull request sidebar, built from `.github/pr-buttons.yml` at the PR's head commit. Each button dispatches its workflow on the head branch, shows a spinner, and then opens the new run.
- Buttons with `paths` that match none of the PR's changed files move under a collapsed **Other workflows** section. The rules are the same as a workflow's `on.pull_request.paths`.
- A list of the latest dispatched runs of those workflows on the head commit, because `workflow_dispatch` runs do not show in the PR's checks. Runs on older commits are under **Other runs**, with their commit. On hover, each run can be cancelled or re-run.
- Each button is checked against its workflow when the page loads. A button whose workflow is missing, has no `workflow_dispatch` trigger, or does not match its inputs is disabled, with the reason under it.
- `schema.json`, a JSON Schema for `.github/pr-buttons.yml`, for checking and completion in editors.
