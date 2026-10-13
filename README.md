# GitHub PR Buttons

A Chrome extension that adds a **Workflows** section to the pull request sidebar on github.com. A repo lists buttons in `.github/pr-buttons.yml`. Each button dispatches a workflow on the PR's head branch and then opens the new run.

Use it for workflows you run on demand, instead of label triggers: screenshots, a slow test suite, a preview deploy.

Below the buttons is a list of the latest dispatched runs of those workflows on the PR's head commit. `workflow_dispatch` runs do not show in the PR's checks, so this is where you see them. Runs on older commits are in a collapsed "Other runs" section, with their commit. On hover, each run shows an icon button: cancel while it is queued or running, re-run failed jobs when it failed, and re-run all jobs when it was cancelled.

## Install

1. Download `github-pr-buttons.zip` from the [latest release](https://github.com/frolic/github-pr-buttons/releases/latest) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, and click **Load unpacked**. Select the unzipped folder.
3. Open the extension's **Details → Extension options** and paste a fine-grained personal access token. Give it access to the repos you use, with these repository permissions:
   - Actions: read and write
   - Contents: read
   - Pull requests: read

The token stays in the extension's local storage. Only the extension's service worker sends it, and only to `api.github.com`. Dispatched runs are attributed to the token's owner.

To update, download the zip again, replace the folder's contents, and click the reload button on the extension's card.

## Configure a repo

Add `.github/pr-buttons.yml`. The extension reads it from the PR's head commit, so a PR can add or change its own buttons.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/frolic/github-pr-buttons/main/schema.json
buttons:
  - label: Render screenshots
    workflow: screenshots.yml
    description: Shown as the button's tooltip.
    inputs:
      some-input: value
    paths:
      - 'apps/web/**'
      - '!**/*.md'
```

The first line points editors at [`schema.json`](schema.json): VS Code with the YAML extension and JetBrains IDEs then check the file and complete its fields as you type.

- `label`: the button text.
- `workflow`: the workflow file name in `.github/workflows/`. The workflow must have a `workflow_dispatch` trigger.
- `description` (optional): the tooltip.
- `inputs` (optional): `workflow_dispatch` inputs.
- `paths` (optional): when the PR changes no matching file, the button moves into a collapsed "Other workflows" section below the others. The rules are the same as a workflow's `on.pull_request.paths`: `*` does not match `/`, `**` does, a pattern that starts with `!` excludes, and the last pattern that matches a file decides. A renamed file counts under its old and new name. A button without `paths` is always in the main list. List the source paths that make the button useful; they do not need to match the workflow's own trigger paths.

When a button cannot work, it is disabled and the reason shows under it: a missing or invalid field, a workflow file that is not on the branch, a workflow without a `workflow_dispatch` trigger, an input the workflow does not declare, or a required input that is missing. The other buttons still work. Only YAML that cannot be read, or a file without a `buttons` list, replaces the whole section with an error.

## Writing the workflow

The workflow runs from the PR's head branch, so it uses that branch's copy of the workflow file. In the workflow, `github.event_name` is `workflow_dispatch` and `github.ref_name` is the head branch. There is no `github.event.pull_request`. To find the PR, look it up by branch:

```sh
gh pr list --head "$GITHUB_REF_NAME" --state open --json number --jq '.[0].number'
```

A workflow that skips draft PRs with `github.event.pull_request.draft == false` also skips dispatched runs. Use `github.event_name != 'pull_request' || !github.event.pull_request.draft`.

Buttons are disabled on PRs from forks, because a workflow cannot be dispatched on a fork's branch.

## Limits

- The section only shows on the **Conversation** tab, and it depends on GitHub's sidebar markup, which is not a public API. A GitHub redesign can hide it until the extension is updated.
- `paths` only sees the first 3000 changed files, the API's limit.
- The runs list cannot tell a button dispatch from one started in the Actions tab on the same branch; both are listed.

## Develop

```sh
npm install
npm run build
```

To release, bump the version in `src/manifest.json` and add its section to [`CHANGELOG.md`](CHANGELOG.md). The push to `main` publishes the release with that section as its notes.

`npm run build` writes the unpacked extension to `dist/extension` and the zip to `dist/github-pr-buttons.zip`. Load `dist/extension` with **Load unpacked**, and click reload on the extension's card after each build. PRs get a preview build, linked from a comment on the PR.
