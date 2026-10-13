# Privacy

GitHub PR Buttons runs only on github.com. It collects no data and sends nothing to its developer or to any third party.

## What it reads

On a pull request page, the extension reads, through your signed-in github.com session:

- the pull request's branch, head commit and changed file paths,
- `.github/pr-buttons.yml` and the workflow files it names,
- the repository's workflow runs on the pull request's branch.

When you click a button, cancel a run or re-run one, it submits the same github.com form that the Actions tab uses. All requests go only to github.com.

## What it stores

To show the sidebar section quickly, the extension keeps these in Chrome's extension storage on your computer:

- config and workflow files, keyed by commit,
- which commit each workflow run belongs to,
- the last state of the section for recently opened pull requests.

Each of these is capped, and the oldest entries are removed first. Removing the extension deletes all of it.

## Contact

Open an issue at https://github.com/frolic/github-pr-buttons/issues.
