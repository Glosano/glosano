# Container releases

Glosano's release image is `ghcr.io/glosano/glosano:vX.Y.Z`. The same image
contains the frontend and runs either `glosano serve` or `glosano worker`.
It supports Linux amd64 and arm64. Python, Node.js and Git are not needed on
the destination server. Use an explicit release version; there is no `latest`
image tag and existing release versions must never be replaced.

## Maintainers

1. Merge the reviewed changes into `main` and choose a new `vX.Y.Z` tag.
2. Push the tag at that main commit. `Docker images` builds on native amd64 and
   arm64 runners, then tests each image with real PostgreSQL and Redis. The
   smoke test checks the frontend, authentication and a worker-processed import
   with AI disabled. Only after both pass are those exact images published.
3. On the first publication, set the GHCR package visibility to **Public**.
   Public repository visibility alone does not make a package public. Check
   an anonymous pull from a clean Docker credentials directory for both platforms.
4. Confirm the multi-platform manifest and document the version in release notes.

Publication uses the repository's `GITHUB_TOKEN` with `packages: write`.
PR jobs have read-only permissions and cannot publish. Tags must point to a
commit reachable from `origin/main`. Protect release tags against replacement
and restrict who can create them in the repository rulesets.

To run the same smoke test locally:

```bash
docker build -f backend/Dockerfile --target runtime -t glosano:smoke .
deploy/tests/smoke.sh glosano:smoke
```

The test creates and removes only its uniquely named disposable Compose project.
It must never target an existing installation. Internal API checks forward
Secure cookies explicitly; this is not a browser/HTTPS acceptance test.

Until a version has passed publication and anonymous pull checks, do not advertise
that version as available. See [self-hosting](self-hosting.md) for installation.
