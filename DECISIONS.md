# Project decisions

Locked-in answers and implementation choices for `unblock`, recorded so later
steps (and reviews) don't have to re-litigate them. Anything under "Made during
Step 1" can be overridden — flag it in review.

## Answered before Step 1

| Topic                          | Decision                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Repo scale                     | Under 500 issues; full upfront fetch, hard cap at 500 with a visible truncation warning                     |
| Anonymous linked-PR strategy   | Capped per-issue REST timeline calls (budget-aware) + "sign in with GitHub" hints                           |
| Linked PR definition           | Closing links only: `Closes/Fixes/Resolves #n`, GitHub-native links, manually linked PRs. Mentions excluded |
| Dependency parsing             | Text keywords + task lists + GitHub-native relationships; same-repo refs only                               |
| Auto-layout direction (Step 2) | **Top-to-bottom** (blockers above what they block)                                                          |
| GitHub data cache              | localStorage, 5-minute TTL, manual refresh bypasses it                                                      |
| Verification repo              | `sveltejs/svelte`                                                                                           |
| Stack defaults accepted        | bun, Tailwind v4, strict TS, adapter-cloudflare (project was already scaffolded this way)                   |

## Made during Step 1 (correct me if wrong)

1. **Issues sort when truncated**: capped fetches are ordered by `updated DESC`,
   so the 500 kept issues are the most recently _active_ ones, not the newest
   created. Rationale: PM relevance.
2. **PRs excluded from the issues list**: GitHub's `/issues` returns PRs mixed in;
   they're filtered out and PRs are fetched separately (draft state included).
3. **Anonymous PR-link detection, two passes** (within the chosen budget):
   - Pass 1 (cheap, full coverage): parse closing keywords in the bodies of all
     open PRs → links issues to open PRs including drafts.
   - Pass 2 (budget-capped): REST timeline `connected` events for issues without
     links yet — catches manually linked and already-closed/merged PRs.
     The warning banner says exactly which issues only got pass-1 coverage.
4. **Native relationships (anonymous)**: discovered via `is:blocked` search
   (1-2 calls), then enumerated per blocked issue via
   `issues/{n}/dependencies/blocked_by` (cap 30). Enumerating only `blockedBy`
   still sees every native edge, since "A blocks B" is the same relationship as
   "B is blocked by A". GraphQL mode reads `Issue.blockedBy` inline instead.
5. **Closed blockers are resolved, not hidden**: any issue referenced as a
   dependency but outside the scope (e.g. closed in open-only mode) is fetched
   individually (cap 60, budget-aware) so its state/assignees are known — this
   is the data that Step 2's "resolved blocker" handling will need.
6. **Task-list items pointing at PRs** are kept as references and shown in the
   debug output, but are not drawn as issue→issue dependency edges (PR numbers
   share the issue numbering space). A warning lists them.
7. **Parser details**: recognizes `blocked by`, `blocker(s):`, `depends on`,
   `depend on`, `requires`, `blocks #n` (reverse), comma-separated lists, and
   task-list items. A task item whose content _is_ a reference
   (`- [ ] #56`, `- [ ] #56 plus notes`, `- [ ] <same-repo issue URL>`) yields
   **only that leading reference**; prose task items still honour explicit
   keywords. The bare noun `dependencies` is matched **only as a line label**
   (`Dependencies: #12`, `**Dependencies:** #12`) — mid-sentence occurrences
   are prose ("the derived's dependencies … unlike #17099") and created
   real-world false edges, verified live on sveltejs/svelte. Excludes fenced
   code blocks, inline code, blockquotes, and HTML comments. Cross-repo refs
   (`owner/other#n`, foreign URLs) are ignored.
   Verified by a 55-check offline suite: `bun src/lib/github/verify.ts`.
8. **Reactions in anonymous mode** come from the issues-list payload; if GitHub
   ever omits them they render as `?` rather than fake zeros.
9. **GraphQL linked PRs** use `Issue.closedByPullRequestsReferences(includeClosedPrs: true)`
   — GitHub's "Development" section, including manually linked PRs. Cross-repo
   PRs (a fork's own PR linked to this repo's issue) are kept and flagged
   `crossRepository` so the UI can mark them `(cross-repo)`. Careful: the
   GraphQL `PullRequest.isCrossRepository` field is the WRONG signal here —
   it means "PR opened from a fork", true for nearly every community PR.
   The reliable check is the PR's own URL vs the board's `owner/repo`
   (verified live: ~180 fork PRs were initially misflagged on sveltejs/svelte).
10. **Rate-limit short-circuit**: anonymous mode checks the quota right after
    the repository-info call and stops with a clean message (reset time +
    sign-in hint) instead of burning the remaining calls one by one. The IP's
    60/hr bucket is shared with anything else running locally, so the app
    treats a pre-drained quota as a normal, surfaced condition.

- **REST anonymous coverage nuance**: GitHub's REST `/issues` endpoint
  returns PRs mixed in with issues, and they count against the 500-item
  cap. On a busy repo most recently-updated items can be PRs
  (sveltejs/svelte: 283 of 500 slots → only 217 issues). GraphQL has no
  such problem (its `issues` connection excludes PRs). Acceptable at the
  chosen <500-issue scale; a future knob could top up issue pages if
  PRs crowd them out.

12. **Tooling notes (not product decisions)**: svelte-check 4.7.x type-checks
    `.svelte-kit/output` chunks after a production build (its ignore list
    only covers watch events) — run `bun run check` before `bun run build`
    or clean the build dirs first. `wrangler dev` (preview) changes what
    `wrangler types` expects to generate (it adds a typed
    `GlobalProps.mainModule` referencing the built worker), so the generated
    `worker-configuration.d.ts` is gitignored and regenerated by
    `bun install` via the `prepare` script; run `bun run gen` after preview
    sessions to satisfy `wrangler types --check`.

## Deferred to Step 2 (ask then)

- ~~Open-only mode: hide resolved blockers vs. show a muted `1 resolved blocker` badge.~~
- ~~How task-list PR references should look on the canvas.~~
- Whether native `relates to` relationships should also be drawn (data exists;
  currently only blocking relationships are edges).

## Step 2 decisions (answered + made)

- **Canvas engine**: `@xyflow/svelte` (Svelte 5-native, MIT) + `elkjs` (ELK).
  Dagre was replaced after real-data review (overlapping elbows and arrowhead
  pileups); Excalidraw was rejected (React runtime, drawing canvas rather than a
  node/edge graph).
- **Resolved blockers** (open-only mode): muted on-card `N resolved blocker(s)`
  badge; closed blockers are never drawn as nodes or edges.
- **Linked PRs**: native linked PRs only, shown as chips on the card and a list
  in the drawer; never drawn as dependency edges.
- **Chain frames**: included — connected components become labeled
  `Chain · N issues` frame nodes; singletons are packed into a single
  `Independent · N issues` frame.
- **Layout**: one ELK pass for all chains, packed to a landscape component
  aspect; independent issues packed shortest-column with adaptive columns.
  ELK owns edge endpoints and routing (no fixed ports, no post-processing);
  frames are parent nodes for packed geometry; the canvas is read-only. Card
  geometry remains the pre-clone 240 × 132–210 layout.
- **Board route is client-only** (`ssr = false`): anonymous data is fetched
  browser-side; signed-in GraphQL goes through the server proxy and the OAuth
  token stays in an encrypted, HttpOnly cookie.
- **Entry flow**: home page becomes the entry form (URL + optional GitHub
  sign-in + scope) and navigates to `/[owner]/[repo]?scope=open|all`; the Step 1
  raw-data view moves to `/debug`.
- **Comparison reference**: `niaefeup/tts` (the issues.martonpaulo.com demo) is
  used to sanity-check chain/edge organization against the reference graph.

## Superseded

- Step 1/early Step 2 parser decisions (text keywords, task-list deps, label
  keywords, bare-noun exclusions, native-over-stale-text precedence) are
  **superseded** by the native-only blocking relationship decision above.
- The body-text dependency parser (`parse-deps.ts`) and its tests were deleted;
  dependencies now come solely from GitHub's own Relationships attribute, which
  is curated data rather than prose.
- The literal visual clone of issues-graph (pastel state cards, Figtree/Gabarito,
  compact card rows, quiet header, removed MiniMap/Controls) is **superseded**:
  the pre-clone neutral UI is back as a placeholder. Design is a later step.

## Step 2 layout organization (latest pass)

- **Reference routing (issues-graph model)**: no fixed ports. Every chain goes
  into one ELK graph (`layered`, DOWN, `ORTHOGONAL`, `NETWORK_SIMPLEX`,
  `LAYER_SWEEP`, spacing 28/76/20/16, `separateConnectedComponents`, component
  spacing 76, `aspectRatio 1.9`). ELK chooses each edge's border endpoints and
  reserves lanes; the edge component draws the resulting polyline with 7px
  rounded corners. There is no post-layout node movement, port distribution,
  target-lane pass or custom edge repair.
- **Cards and frames**: cards are the pre-clone 240 × 132–210 placeholder;
  chain and independent frames wrap node bounds after layout. Independent
  issues use shortest-column packing with adaptive columns; the narrower of the
  chain cluster and the loose block is centered against the wider one.
- **Read-only canvas**: `nodesDraggable={false}`. Pan, zoom and selection still
  work; Auto-Layout refits.
- **Rebuild correctness**: the canvas is keyed by a reactive `layoutRevision`
  wrapping the whole `SvelteFlowProvider`, so every rebuild gets a fresh flow
  store instead of retaining old edge geometry.
- **Verified on the 117-issue tts graph**: 28 edges, **0 edge/card crossings**,
  **0 edge–edge crossings**, **0 shared segments** (all pairs, including
  fan-in/fan-out), endpoints on card borders, no frame overlap and no clipped
  titles; final aspect 1.44. Reference spacing uses more canvas area than the
  earlier tight layout, but it is the cleanest routing.
- **Superseded**: fixed bottom-centre/top-centre ports, distributed source and
  target ports, target approach lanes, L-approaches, top-aligned row
  post-processing, the `avoidCards` repair and the tight-spacing benchmark.
  Those were attempts to force the old port model; the reference router is
  cleaner without them.
- **Not in this pass**: colours, typography, card content and chrome remain the
  pre-clone placeholder. No visual-language decisions are being made here.

## Issue-card visual language (design pass)

- **Docker-inspired system**: warm Canvas `#F5F2EE` behind paper `#FFFDFA`
  cards, Ink `#1D1D1D` text, Base Blue `#6172FF` for assigned cards and primary
  actions, Trigger Red `#FF3D40` for blocked accents, and warm neutral lines
  (`#DDD4C9`/`#E7DFD5`). Tokens live in `src/routes/layout.css` as Tailwind
  `@theme` colors.
- **State is the border, and open is implicit**: unassigned and closed cards use
  the warm neutral border, assigned cards use Base Blue, blocked cards use red.
  Blocking takes precedence over assignment; the assignee is still shown next to
  the blocked badge. Open issues carry no state label at all; closed cards show
  a quiet mono `CLOSED` label. This avoids a green “OPEN” marker on every card.
- **Card width is 272px** (up from the 240px placeholder). Heights are still
  estimated before layout, but the geometry now lives in
  `src/lib/board/card-metrics.ts`, shared by the ELK layout and
  `IssueCard.svelte` so the two cannot drift apart.
- **Every previous data point remains**: number, state (open is implicit; closed
  is labelled), assignee stack or `Unassigned`, title (up to three lines), two
  labels plus overflow, milestone, reactions, updated age, open-blocker
  ratio/count, resolved-blocker count, and two linked PRs plus overflow.
- **Dependency edges stay neutral**: every issue→issue edge uses one warm gray
  and arrowhead; selecting a card darkens its edges instead of turning them red.
  Red is reserved for the blocked card state, so the graph doesn't compete with
  the cards for attention.
- **Chips are monochrome with colour dots**: labels use the real GitHub label
  colour as a 5px dot inside a warm neutral chip; linked PRs reuse the same chip
  shape with a semantic status dot and mono status/number. This keeps label and
  PR identity without filling the card with competing pastel pills.
- **Blocked badge**: a squared, icon-led technical badge — prohibition glyph,
  mono `BLOCKED` label, and a solid red count capsule (`2` or `2/3`) — rather
  than a generic rounded pill.
- **Pattern Language**: 16px card corners, 2px state borders, 5–6px technical
  chips, quiet shadows, a subtle hover lift (fine pointers only), and a
  press-scale. Frames are soft warm containers with a blue marker and mono
  labels. Motion is limited to 160ms transform/shadow transitions and is
  disabled under `prefers-reduced-motion`.
- **Typography**: DM Sans (Docker's approved fallback for GT Planar) and DM Mono
  (GT Standard Mono fallback), self-hosted via Fontsource. Titles are
  15px/19px semibold; issue/PR numbers, state labels, and technical metadata use
  DM Mono. The warm system also covers the board header, frames, drawer, and
  entry screen.

## GitHub sign-in (replaces the optional PAT)

- **OAuth App, not GitHub App**: the app needs a user-scoped token and a single
  authorization step; a GitHub App would add JWT signing, install flows and
  per-installation tokens for little benefit at this stage.
- **Sign-in is optional**: anonymous public-repo browsing remains the default.
  With no OAuth credentials configured, the UI says sign-in is unavailable and
  the anonymous REST loader still works.
- **No scopes by default**: public data plus the user's 5,000 req/hr bucket.
  Private repos are an explicit opt-in that requests GitHub's broad `repo`
  scope (OAuth Apps have no read-only private scope). The UI states this.
- **Token never reaches the browser**: the callback stores it in an AES-GCM
  encrypted, HttpOnly, SameSite=Lax cookie; signed-in GraphQL calls go through
  a same-origin `/api/github/graphql` proxy. Anonymous REST still goes directly
  from the browser to `api.github.com`.
- **No database**: the session is a self-contained encrypted cookie with a
  30-day lifetime. Signing out clears the cookie and all cached repo data.
- **Setup**: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`
  (documented in `.env.example`). The callback URL is derived from the request
  origin (`/auth/github/callback`), so dev and production use separate OAuth
  App callback URLs.
- **Removed**: the PAT input, `unblock:pat` storage helpers and the legacy
  localStorage key (cleaned up on first load).
