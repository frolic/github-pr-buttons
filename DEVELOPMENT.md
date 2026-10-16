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

Bump the version in `src/manifest.json` and add its section to [`CHANGELOG.md`](CHANGELOG.md). Then run the **Build** workflow by hand on `main`: it publishes the GitHub release with that section as its notes. Pushes to `main` only build.

Upload the release zip to the Chrome Web Store in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole). The store text and images are in [`store/`](store/).
