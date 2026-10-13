# Chrome Web Store listing

Text for the Developer Dashboard fields, and the images to upload:

- Store icon: `icon-128.png`
- Screenshot: `screenshot-1280x800.png`
- Small promo tile: `promo-small-440x280.png`
- Package: `github-pr-buttons.zip` from the release

## Store listing

**Name:** GitHub PR Buttons

**Summary** (132 characters at most):

> Run your repo's GitHub Actions workflows from buttons in the pull request sidebar. Buttons are set in .github/pr-buttons.yml.

**Category:** Developer Tools

**Language:** English

**Description:**

> Adds a Workflows section to the pull request sidebar on github.com, with buttons that run your repository's GitHub Actions workflows on the pull request's branch.
>
> Use it for workflows you run on demand instead of on every push: slow test suites, snapshot updates, staging deploys, load tests.
>
> • One click runs the workflow on the PR's branch and opens the new run.
> • Buttons with `paths` move to a collapsed "Other workflows" section when the PR does not touch those paths.
> • Below the buttons, a list of the runs on the PR's branch, with cancel and re-run on hover. Workflow-dispatch runs do not show in the PR's checks, so this is where you see them.
> • A button that cannot work, for example because its workflow has no workflow_dispatch trigger, is disabled with the reason.
> • No token to set up: the extension uses your github.com session.
>
> Set up a repository by adding .github/pr-buttons.yml:
>
> buttons:
>   - label: Run integration tests
>     workflow: integration-tests.yml
>     paths: ['src/**']
>
> Each workflow needs a workflow_dispatch trigger. Full docs: https://github.com/frolic/github-pr-buttons

**Homepage URL:** https://github.com/frolic/github-pr-buttons

**Support URL:** https://github.com/frolic/github-pr-buttons/issues

## Privacy practices

**Single purpose:**

> Shows buttons in the GitHub pull request sidebar that run the repository's GitHub Actions workflows, and lists those workflows' runs.

**Permission justifications:**

- **storage:** Caches files by commit and the last state of each pull request's sidebar section, so the section shows at once.
- **Host permission (https://github.com/\*):** The content script adds the section to pull request pages, reads the pull request, config, workflow files and run list from github.com, and submits github.com's own forms to run, cancel and re-run workflows.

**Remote code:** No. All code is in the package.

**Data usage:** Select **Website content**. It is read from github.com to render the section, kept only in local extension storage, and never sent anywhere but github.com. Check all three certifications: not sold, not used for unrelated purposes, not used for creditworthiness or lending.

**Privacy policy URL:** https://github.com/frolic/github-pr-buttons/blob/main/PRIVACY.md
