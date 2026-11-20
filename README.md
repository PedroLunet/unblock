# unblock

A minimalist, open-source PM board for GitHub issues: paste a repository URL and
see its issues, dependencies, and linked pull requests. No login, no accounts.

This is a staged build — currently at **Step 2 (infinite dependency canvas)**:
paste a repository on the home page and get an interactive, auto-laid-out
dependency graph of its issues (`/[owner]/[repo]`), with filters and a detail
drawer. Blocking relationships come exclusively from **GitHub's native issue
Relationships attribute** — body text and task lists are not parsed. The raw
data-verification view lives at `/debug`.

## Development

```sh
bun install
bun run dev        # vite dev server
bun run check      # wrangler types + svelte-check
bun run build      # production build via @sveltejs/adapter-cloudflare
bun run preview    # run the production worker locally (wrangler dev)
bun src/lib/github/verify.ts   # offline parser/input verification suite
```

Note: run `bun run check` before `bun run build` (or remove `.svelte-kit/output`
afterwards) — svelte-check currently also type-checks build-output chunks when
they exist, which drowns out real diagnostics. Also run `bun run gen` after a
`bun run preview` session: `wrangler dev` leaves the generated
`worker-configuration.d.ts` in a state `wrangler types --check` considers stale.

## GitHub access

- Anonymous: public repos, 60 req/hr per IP (the app budget-caps its calls and
  says exactly what was skipped). Native dependency enumeration is cheap for
  small graphs but capped on larger repos — a PAT is recommended for complete
  dependency data.
- Optional PAT: paste a read-only token in the page — stored only in your
  browser's `localStorage`, sent only to `api.github.com`. Unlocks GraphQL
  mode: private repos (if the token can see them), 5,000 req/hr, complete
  linked-PR and native-relationship data.

## Dependency data

Blocking relationships are read exclusively from GitHub's issue
**Relationships** attribute (GraphQL `Issue.blockedBy`, REST
`dependencies/blocked_by`). Text, task lists and labels are intentionally not
parsed — real repositories showed stale prose producing false and reversed
edges. Repositories that don't use the Relationships attribute simply show no
dependency edges (the board says so).

## Layout

- `src/lib/github/` — the data layer: input parsing, native relationship
  mapping, REST (anonymous) and GraphQL (PAT) loaders, localStorage cache,
  orchestrator.
- `src/lib/board/` — the canvas: `graph.ts` (ELK layout + routing, chain
  frames, filters), `IssueNode.svelte`, `ChainFrame.svelte`, `RoundedEdge.svelte`
  (rounded orthogonal bottom→top edges), `BoardCanvas.svelte` (Svelte Flow
  wrapper), `IssueDrawer.svelte`.
- `src/routes/+page.svelte` — entry form (repo URL, optional PAT, initial scope).
- `src/routes/[owner]/[repo]/` — the board route (client-only: `ssr = false`).
- `src/routes/debug/+page.svelte` — raw data verification view.
- `DECISIONS.md` — locked-in product/implementation decisions per step.
