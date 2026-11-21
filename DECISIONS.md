# Project decisions

Locked-in answers and implementation choices for `unblock`, recorded so later
steps (and reviews) don't have to re-litigate them. Anything under "Made during
Step 1" can be overridden — flag it in review.

## Answered before Step 1

| Topic                          | Decision                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Repo scale                     | Under 500 issues; full upfront fetch, hard cap at 500 with a visible truncation warning                     |
| Anonymous linked-PR strategy   | Capped per-issue REST timeline calls (budget-aware) + "add a PAT" hints                                     |
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
    PAT hint) instead of burning the remaining calls one by one. The IP's
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
- **Resolved blockers** (open-only mode): shown as a compact `N resolved` footer
  item when there is no PR or milestone to show, with the full list in the
  drawer. Closed blockers are never drawn as nodes or edges.
- **Linked PRs**: native linked PRs only, shown as a footer chip on the compact
  card and as a full list in the drawer; never drawn as dependency edges.
- **Chain frames**: included — connected components become labeled
  `Chain · N issues` frame nodes; singletons are packed into a single
  `Independent · N issues` frame (matching the issues.martonpaulo.com reference).
- **Layout**: one ELK pass for all chains, packed to a landscape aspect;
  independent issues packed shortest-column with adaptive columns; compact card
  geometry (240px wide, height from 1–4 title lines). Frames are parent nodes
  (dragging a frame moves the whole chain, children stay inside).
- **Board route is client-only** (`ssr = false`): the PAT lives in
  localStorage and all fetching is browser-side.
- **Entry flow**: home page becomes the entry form (URL + PAT + scope) and
  navigates to `/[owner]/[repo]?scope=open|all`; the Step 1 raw-data view
  moves to `/debug`.
- **Comparison reference**: `niaefeup/tts` (the issues.martonpaulo.com demo)
  is used to sanity-check chain/edge rendering against the reference graph.

## Superseded

- Step 1/early Step 2 parser decisions (text keywords, task-list deps, label
  keywords, bare-noun exclusions, native-over-stale-text precedence) are
  **superseded** by the native-only blocking relationship decision above.
- The body-text dependency parser (`parse-deps.ts`) and its tests were
  deleted; dependencies now come solely from GitHub's own Relationships
  attribute, which is curated data rather than prose.

## Step 2 visual refinements (latest pass)

- **Reference and stack**: `martonpaulo/issues-graph` (MIT) is the visual and
  layout reference: React Flow + ELK, compact pastel cards, Figtree/Gabarito.
  We keep Svelte Flow and the native-only data layer; the layout configuration
  and visual language port directly. Excalidraw remains rejected (React
  runtime, drawing model rather than live data cards).
- **One ELK pass, landscape packing**: every dependency chain goes into a single
  ELK graph (`layered`, DOWN, `ORTHOGONAL`, `NETWORK_SIMPLEX`, `LAYER_SWEEP`,
  spacing 28/76/20/16, `separateConnectedComponents`, component spacing 96,
  `aspectRatio 1.9`), so components pack against each other instead of being
  stacked in source order. Loose issues use shortest-column packing with an
  adaptive column count targeting a final canvas aspect of ~1.4; the narrower
  of the chain cluster and the loose block is centered against the wider one.
  Chain frames are drawn after layout (16px padding, 26px label strip). ELK is
  still lazy-loaded.
- **Compact cards**: 240px wide, 75–147px tall: header (number + state word),
  title 1–4 lines × 17px, optional one 17px row of label chips, and a footer
  (assignees on the left; first PR, resolved-blocker count, or milestone on the
  right). Reactions, avatars, the old milestone row and badge rows live only in
  the drawer. `graph.ts` height constants mirror `IssueNode.svelte` exactly; no
  flex row may grow or shrink.
- **State on the card surface**: blocked = amber, in progress = blue, in review
  = teal, unassigned = white, closed = grey. The state word sits top-right, and
  blocked appends the open/total count (`blocked · 2/3`) with a tooltip. Colour
  is never the only signal — the state is always written.
- **Quiet edges**: every dependency is 1.3px `#8c97a8` at 75% opacity with 7px
  rounded corners; connected edges lift to accent blue on hover/selection and
  unrelated edges dim to 20%. Blocked state lives on the target card, not in a
  red stroke.
- **Fonts and surfaces**: Figtree 400/500/600 body, Gabarito 700 display, mono
  issue numbers; `#f3f5f8` canvas, white/pastel cards with 1px lines, 10px card
  radius, 14px frame radius and a soft shadow. Chain frames are pale blue and
  filled; the independent frame is dashed and unfilled. Canvas dots are 24px.
  `@xyflow/svelte/xy-theme.css` keeps the documented layer order and light-mode
  variable overrides. The theme's default node padding/border is reset for issue
  and frame nodes so both components fill ELK's exact dimensions.
- **Chrome and interaction**: one quiet 12px header row (repo, scope toggle,
  filters, Auto-Layout, arrow legend, counts). Wheel pans (`panOnScroll`, 0.6),
  pinch zooms, double-click zoom is disabled. The MiniMap, zoom Controls and
  floating legend panel are removed; the header's Auto-Layout action refits and
  the arrow legend now lives in the header.
- **Edge geometry guarantee**: every card has one fixed bottom-center source
  port and one top-center target port. After ELK routes, `avoidCards` repairs
  any segment that would cross a card using global free corridors. Headless
  tests check zero edge/card intersections, bottom/top anchors, rounded paths,
  frame overlap, title overflow and drag behavior. Dragging re-anchors the
  seeded route (stretching the final leg) instead of falling back to a straight
  line.
- **Superseded in this pass**: red edges / red left strip / corner counter,
  avatar and milestone rows on cards, per-chain ELK with a vertical frame stack,
  the floating-bezier experiment, the `Panel` legend, the MiniMap and the zoom
  Controls.
