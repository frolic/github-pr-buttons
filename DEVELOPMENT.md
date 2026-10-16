# Development

## Build

```sh
npm install
npm run build
```

`npm run build` writes the unpacked extension to `dist/extension` and the zip to `dist/github-pr-buttons.zip`.

## Load from source

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select `dist/extension`.
3. After each build, click reload on the extension's card.

Disable the Chrome Web Store copy while you test, so that only one copy adds the section.

PRs get a preview build, linked from a comment on the PR. To try it, unzip it and load the folder the same way.

Each [release](https://github.com/frolic/github-pr-buttons/releases) also has the zip, for installs without the Chrome Web Store.

## Release

Bump the version in `src/manifest.json` and add its section to [`CHANGELOG.md`](CHANGELOG.md). Then run the **Build** workflow by hand on `main`. It publishes the GitHub release with that section as its notes, and submits the zip to the Chrome Web Store for review. The new version goes live when the review passes. Pushes to `main` only build.

A run without a version bump updates that GitHub release's zip and notes. It skips the store when the store already has that version, because the store only accepts a higher one.

The store listing text and images are in [`store/`](store/). Change them in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole).

### Store access

The workflow gets a Chrome Web Store token from a Google Cloud service account, through GitHub's OIDC token. There is no key or secret to store. One-time setup:

1. In a Google Cloud project, enable the **Chrome Web Store API**.
2. Create a service account with no roles.
3. In the Chrome Web Store Developer Dashboard, under **Account**, add the service account's email.
4. Create a workload identity pool with a GitHub OIDC provider, limited to this repository (`assertion.repository == 'frolic/github-pr-buttons'`). Give the pool's principal for this repository the **Service Account Token Creator** role on the service account.
5. Set these repository variables:
   - `GCP_WORKLOAD_IDENTITY_PROVIDER`: `projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`
   - `GCP_SERVICE_ACCOUNT`: the service account's email
   - `CWS_PUBLISHER_ID`: the publisher ID from the Developer Dashboard
