# Publishing checklist

1. Create the public repo `obsidian-preview-gallery` on GitHub and push `main`.
2. Release: `git tag 0.5.0 && git push origin 0.5.0` → the workflow makes a **draft** release with `main.js`, `manifest.json`, `styles.css`. Review it on GitHub and publish.
3. Store: fork `obsidianmd/obsidian-releases`, add this to the end of `community-plugins.json`, and open a PR using their template:

```json
{
  "id": "preview-gallery",
  "name": "Preview Gallery",
  "author": "Hannah",
  "description": "Notion-style gallery and board views for Bases, with note text previews, side peek, and inline comments.",
  "repo": "hannahedame-byte/obsidian-preview-gallery"
}
```

For each new version: bump `version` in `manifest.json`, add it to `versions.json`, commit, then tag with the same version.
