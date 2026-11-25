# unblock

A minimalist, open-source PM board for GitHub issues: paste a repository URL and
see its issues, dependencies, and linked pull requests. No account required —
sign in with GitHub only when you want private repositories or higher limits.

This is a staged build — currently at **Step 2 (infinite dependency canvas)**
plus inline issue editing: paste a repository on the home page and get an
interactive, auto-laid-out dependency graph of its issues
(`/[owner]/[repo]`), with filters and a detail drawer. Signed-in users with
write access can change an issue's assignees, labels, milestone and open/closed
state straight from the drawer, mirroring GitHub's issue sidebar. Blocking
relationships come exclusively from **GitHub's native issue Relationships
attribute** — body text and task lists are not parsed. The raw
data-verification view lives at `/debug`.

## Development

```sh
bun install
bun run dev        # vite dev server
bun run check      # wrangler types + svelte-check
bun run build      # production build via @sveltejs/adapter-cloudflare
bun run preview    # run the production worker locally (wrangler dev)
bun src/lib/github/verify.ts   # offline parser/input + snapshot-diff suite
```

Note: run `bun run check` before `bun run build` (or remove `.svelte-kit/output`
afterwards) — svelte-check currently also type-checks build-output chunks when
they exist, which drowns out real diagnostics. Also run `bun run gen` after a
`bun run preview` session: `wrangler dev` leaves the generated
`worker-configuration.d.ts` in a state `wrangler types --check` considers stale.

## GitHub access

- Anonymous: public repos, 60 req/hr per IP (the app budget-caps its calls and
  says exactly what was skipped). Native dependency enumeration is cheap for
  small graphs but capped on larger repos — signing in is recommended for
  complete dependency data.
- Sign in with GitHub: OAuth App flow. The access token stays server-side in an
  encrypted, HttpOnly cookie and is never exposed to browser JavaScript; the
  browser talks to `/api/github/graphql`, which proxies requests to GitHub.
  Signing in unlocks GraphQL mode: 5,000 req/hr, complete linked-PR and
  native-relationship data, and private repos if you also grant the `repo`
  scope. Public-only editing asks for `public_repo` (requested when "Allow
  editing issues" is checked, or when you click **Enable editing**); read-only
  sign-in still requests no scopes at all. GitHub OAuth Apps do not offer a
  read-only private-repo scope, so private access is the broad all-or-nothing
  `repo` scope, which also permits writes.

### Sign-in setup

1. Create a GitHub OAuth App at <https://github.com/settings/developers>.
2. Set its **Authorization callback URL** to
   `http://localhost:5173/auth/github/callback` for local development (use a
   second OAuth App, or update the URL, for production).
3. Copy `.env.example` to `.env` and fill in `GITHUB_CLIENT_ID`,
   `GITHUB_CLIENT_SECRET`, and a random `SESSION_SECRET`
   (`openssl rand -base64 32`).
4. For production, add the same values as Worker secrets:
   `bunx wrangler secret put GITHUB_CLIENT_ID` (and the other two). For
   `bun run preview`, put them in `.dev.vars` instead.

If the three variables are absent, the app still runs anonymously and the UI
reports that sign-in is not configured.

## Refreshing data

The board's **Refresh** action always refetches from GitHub — a full refetch is
the only reliable way to see newly opened/closed issues, changed native
relationships and new linked PRs. The result is diffed against the data already
on the board, and the canvas is only rebuilt when something actually changed.

The full payload stays in localStorage for an hour. A separate compact,
body-free snapshot is kept next to it so a refresh can diff against the board
without storing a second full payload; it is cleared with the cache on sign-out.
If the refresh fails, the current board is kept and the error is shown with a
retry.

## Editing issues

The drawer mirrors GitHub's issue sidebar. The **assignees**, **labels** and
**milestone** rows each have a small gear that opens a floating picker anchored
to that row; the footer adds **Close issue** / **Reopen issue**. There is no
full edit form — changes apply as you pick them.

- **Assignees** — search GitHub's own `assignableUsers` list, add or remove up
  to 10 people (GitHub's limit).
- **Labels** — filter and toggle the repository's labels.
- **Milestone** — pick an open milestone or clear it; the row shows the due date
  and GitHub's completion percentage.
- **State** — close or reopen the issue from the footer.

Every change goes straight to GitHub through a partial GraphQL `updateIssue`
mutation containing only the changed fields. The result is merged back into the
board (and its cache/snapshot) without a full refetch, and the canvas only
rebuilds if the visible data changed. Closing an issue in open-only scope
removes it from the canvas, matching the board scope.

Editing requires write access. Signed-in sessions that only have read access
show **Enable editing**, which re-runs OAuth with `public_repo`; private-repo
sessions already hold `repo`, which includes writes. Anonymous visitors get a
**Sign in to edit** link. Title and description are still read-only in unblock.

## Dependency data

Blocking relationships are read exclusively from GitHub's issue
**Relationships** attribute (GraphQL `Issue.blockedBy`, REST
`dependencies/blocked_by`). Text, task lists and labels are intentionally not
parsed — real repositories showed stale prose producing false and reversed
edges. Repositories that don't use the Relationships attribute simply show no
dependency edges (the board says so).

## Layout

- `src/lib/github/` — the data layer: input parsing, native relationship
  mapping, REST (anonymous) and GraphQL (signed-in, via the server proxy)
  loaders, issue edits (`edit.ts`: assignable users, labels, milestones, the
  partial update mutation), the localStorage cache (1-hour TTL), the compact
  refresh snapshot and diff, and the orchestrator.
- `src/lib/server/auth.ts` and `src/routes/auth/` — GitHub OAuth, encrypted
  session cookie, the GraphQL proxy, and write-scope opt-in.
- `src/lib/board/` — the canvas: `graph.ts` (ELK layout + routing, chain
  frames, filters), `IssueNode.svelte`, `ChainFrame.svelte`, `RoundedEdge.svelte`
  (rounded orthogonal bottom→top edges), `BoardCanvas.svelte` (Svelte Flow
  wrapper), `IssueDrawer.svelte`, `IssueSidebar.svelte`.
- `src/routes/+page.svelte` — entry form (repo URL, optional GitHub sign-in, initial scope).
- `src/routes/[owner]/[repo]/` — the board route (client-only: `ssr = false`).
- `src/routes/debug/+page.svelte` — raw data verification view.
