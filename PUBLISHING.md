# Publishing GuideGraph

GuideGraph is currently prepared for an alpha release, not a stable release.

Recommended first version:

```text
0.1.0-alpha.0
```

Recommended npm dist tag:

```text
alpha
```

## Scope Status

The `@guidegraph/core` and unscoped `guidegraph` package names returned npm `E404` when checked, which means they were not published in the registry at that time.

Before publishing, confirm that the npm account you use can create the `@guidegraph` organization/scope. If not, choose one of these paths:

1. Create or get access to the `@guidegraph` npm organization.
2. Rename packages to a scope you control, for example `@loudsun1997/guidegraph-core`.
3. Publish unscoped package names, for example `guidegraph-core`.

Do not run `npm publish` until the package naming decision is final.

## Package Groups

Core alpha set:

```text
@guidegraph/core
@guidegraph/server
@guidegraph/storage-memory
@guidegraph/storage-postgres
@guidegraph/http
@guidegraph/react
```

Experimental alpha set:

```text
@guidegraph/builder
@guidegraph/react-builder
@guidegraph/graph
@guidegraph/react-graph
@guidegraph/mcp
@guidegraph/devtools
```

## Release Order

Publish packages in dependency order:

```text
@guidegraph/core
@guidegraph/builder
@guidegraph/server
@guidegraph/storage-memory
@guidegraph/storage-postgres
@guidegraph/http
@guidegraph/react
@guidegraph/graph
@guidegraph/react-graph
@guidegraph/react-builder
@guidegraph/devtools
@guidegraph/mcp
```

## Pre-Publish Verification

Run from the repository root:

```sh
pnpm test
pnpm test:postgres
pnpm test:postgres:real
pnpm typecheck
pnpm build
pnpm build:examples
pnpm build:stories
```

The real Postgres test requires `DATABASE_URL` in the shell or `.env.local`.

## Pack Verification

Use `pnpm pack` before publishing:

```sh
mkdir -p /tmp/guidegraph-packs
pnpm --filter @guidegraph/core pack --pack-destination /tmp/guidegraph-packs
pnpm --filter @guidegraph/server pack --pack-destination /tmp/guidegraph-packs
pnpm --filter @guidegraph/storage-memory pack --pack-destination /tmp/guidegraph-packs
pnpm --filter @guidegraph/storage-postgres pack --pack-destination /tmp/guidegraph-packs
pnpm --filter @guidegraph/http pack --pack-destination /tmp/guidegraph-packs
pnpm --filter @guidegraph/react pack --pack-destination /tmp/guidegraph-packs
pnpm --filter @guidegraph/builder pack --pack-destination /tmp/guidegraph-packs
pnpm --filter @guidegraph/graph pack --pack-destination /tmp/guidegraph-packs
pnpm --filter @guidegraph/react-graph pack --pack-destination /tmp/guidegraph-packs
pnpm --filter @guidegraph/react-builder pack --pack-destination /tmp/guidegraph-packs
pnpm --filter @guidegraph/devtools pack --pack-destination /tmp/guidegraph-packs
pnpm --filter @guidegraph/mcp pack --pack-destination /tmp/guidegraph-packs
```

Then create a separate scratch app and install the tarballs to prove imports and types work outside the monorepo.

## Publish Commands

Only run these after the npm scope is confirmed.

```sh
pnpm --filter @guidegraph/core publish --access public --tag alpha
pnpm --filter @guidegraph/builder publish --access public --tag alpha
pnpm --filter @guidegraph/server publish --access public --tag alpha
pnpm --filter @guidegraph/storage-memory publish --access public --tag alpha
pnpm --filter @guidegraph/storage-postgres publish --access public --tag alpha
pnpm --filter @guidegraph/http publish --access public --tag alpha
pnpm --filter @guidegraph/react publish --access public --tag alpha
pnpm --filter @guidegraph/graph publish --access public --tag alpha
pnpm --filter @guidegraph/react-graph publish --access public --tag alpha
pnpm --filter @guidegraph/react-builder publish --access public --tag alpha
pnpm --filter @guidegraph/devtools publish --access public --tag alpha
pnpm --filter @guidegraph/mcp publish --access public --tag alpha
```

For CI-based publishing, prefer npm provenance after the workflow is configured.
