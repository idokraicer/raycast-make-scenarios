# Release Checklist

Use this checklist before cutting any release.

## 1) Finalize scope

- Ensure all release PRs are merged to `main`.
- Move completed items from `Unreleased` to a dated version section in `CHANGELOG.md`.

## 2) Validate quality gates

- Run `npm ci`.
- Run `npm run check`.
- Confirm CI is green on `main`.

## 3) Validate extension metadata

- Confirm `package.json` title, description, commands, and preferences are accurate.
- Confirm extension icon exists at `assets/extension-icon.png`.
- Confirm setup and command docs in `README.md` are current.

## 4) Publish

- Choose version bump:
  - Patch (`x.x.n`): `npm run release:patch`
  - Minor (`x.n.0`): `npm run release:minor`
  - Major (`n.0.0`): `npm run release:major`
- Publish using your standard Raycast extension release flow.
- Verify post-release install/update and first-run setup in Raycast.

## 5) Post-release

- Create a tag/release in your VCS with release notes from `CHANGELOG.md`.
- Start a new `Unreleased` section for follow-up changes.
