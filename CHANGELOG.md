# Changelog

## v0.1.0

GitHub PR Buttons adds a **Workflows** section to the pull request sidebar on github.com. A repo lists buttons in `.github/pr-buttons.yml`, and each button runs a workflow on the PR's branch, then opens the new run. Use it for workflows you run on demand: slow test suites, snapshot updates, staging deploys.

Below the buttons is a list of the runs those workflows made on the PR's branch, with cancel and re-run on hover. There is no token to set up: the extension uses your github.com session.

**Install:** [GitHub PR Buttons on the Chrome Web Store](https://chromewebstore.google.com/detail/github-pr-buttons/celiahddgfpgpabdamncedfleagdbifj).

**Set up a repo:** see the [README](https://github.com/frolic/github-pr-buttons#configure-a-repo).
