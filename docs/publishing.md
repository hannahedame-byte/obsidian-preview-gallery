# Publishing checklist

## Each release

1. Bump `version` in `manifest.json`, add it to `versions.json`, commit, and push `main`.
2. Tag with the same version: `git tag 0.5.1 && git push origin 0.5.1`. The workflow makes a **draft** release with `main.js`, `manifest.json` and `styles.css`.
3. Add release notes on GitHub and publish the draft.

## Community directory (first time only)

Checked against the Obsidian docs on 2026-11-22: [Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin).

1. Publish a release whose tag matches `manifest.json` on `main`.
2. Sign in at [community.obsidian.md](https://community.obsidian.md) with an Obsidian account and link the GitHub account.
3. Add the plugin there. The review is automatic.
4. If it reports problems, fix them and publish a new version.

Later releases are picked up from GitHub automatically.
