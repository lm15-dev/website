# LM15 website

Shared home for the homepage, documentation, and playground. The SDK source
repositories remain separate.

## Local preview

Use Node 22.23.1 or newer:

```sh
npm ci
npm run dev
```

Open the address printed in the terminal. Routes:

- `/`: homepage
- `/docs/`: shared documentation hub
- `/playground/`: interactive playground

## Where things belong

```text
src/pages/          Homepage and standalone pages
src/content/docs/   Documentation written in Markdown
src/styles/         Shared theme and page styles
src/playground/     Playground interface and runtime connections
src/components/     Shared interface components as needed
public/             Logos and license notices
examples/rust/      Generated Rust examples and their dependency lock
scripts/            Website tooling and runtime packaging
tests/              Website, playground, and cross-language checks
planning/           Draft copy and historical implementation notes
```

Brand colors are defined once in `src/styles/theme.css`. Layout styles remain
separate so documentation rules do not leak into the playground.

Generated files live in `.build/` and `dist/`; neither belongs in Git. The
playground is packaged separately from Astro so documentation scripts are not
loaded on the key-bearing page. It still shares the same browser origin; this
is not a security boundary between the documentation and playground.

## SDK updates

`package.json` and `package-lock.json` select a runtime package from this
repository's GitHub Releases. It contains the built TypeScript SDK, Python
wheel, Rust browser module, and Go browser module with its matching Go support
script. `sources.json` records all four source revisions and compiler versions.
The build refuses a runtime package that does not match those revisions.

To update SDKs, push the SDK source revisions, edit `sources.json`, run the
**Build SDK runtime package** GitHub workflow with a new release name, and install that release's package
with `npm install --save-exact <release-package-url>`. Update the Rust example
crate's pinned revision when Rust changes. Review the examples and run the
checks before publishing a runtime update. Never replace an existing release.

Writing a guide or changing the playground does not rebuild the SDKs. The Go
module is built with `GOOS=js GOARCH=wasm`; its `wasm_exec.js` must come from the
exact pinned Go toolchain. All heavy runtimes load only when selected.

Prepare runtime upgrades on a branch: dispatch the runtime workflow on that
branch, install the immutable release, and check the actual built playground
before merging to `main`. This keeps the current public deployment intact while
the new package is being built. Go may use different JSON key order; the page
compares request content without claiming that differently ordered bytes match.

## Local provider keys

`npm run playground:local`, after a site build, opens a private loopback server
with a one-use handoff from `../.env`. This is opt-in. Ordinary previews and
public builds never load credentials. See `src/playground/README.md`.

## Publishing

Push to `main` to publish to **https://lm15.dev/**. The **Publish website** GitHub workflow installs the
locked dependencies, checks types, builds the site, and checks local links.
Only the finished `dist/` folder is uploaded. Proposed changes are checked but
not published. Full test suites are not part of automatic publishing at the
owner's request; these checks do not prove that every playground interaction works.

If a check fails, the current deployment stays live. To roll back, revert the
problematic commit and push to `main`. The replacement passes the same checks.
You can also rerun the workflow manually from GitHub Actions.

The site needs no application server or provider keys in GitHub. GitHub Pages
uses its short-lived deployment token; domain DNS remains at GoDaddy. The
published `/deployment.json` records the website revision, and
`/playground/release.json` records the SDK revisions and asset checksums.

GitHub Pages has no built-in preview deployment for each proposed change and
no custom response headers. The playground retains its HTML security policy;
no analytics or third-party scripts are added.

## Migration status

- Homepage, documentation hub, playground source, tests, and packaging now live here.
- Runtime-package builds and releases are connected to GitHub.
- Automatic publishing and the `lm15.dev` domain handover are complete.
- The public site is served from this repository, with HTTPS enforced.
- Full documentation migration and shared example selectors are still pending.

The former website folders and publishing workflow have been removed from the
TypeScript SDK repository. Its OpenRouter OAuth example remains there
because it demonstrates SDK behavior rather than hosting the website.

Older deployment instructions in `planning/previous-hosting.md` describe the
previous setup, not the new website's publishing process.
