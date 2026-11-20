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

- **Canvas engine**: `@xyflow/svelte@2.0.2` (Svelte 5-native, MIT) + `@dagrejs/dagre@3.1.3`.
  Excalidraw rejected: React runtime, and a drawing canvas rather than a node/edge graph.
- **Resolved blockers** (open-only mode): muted on-node badge
  (`N resolved blocker(s)`), no dimmed closed nodes.
- **Task-list references to PRs**: muted dashed `PR #n` chips on the node and
  a line in the drawer; never drawn as dependency edges.
- **Chain frames**: included — connected components become labeled
  `Chain · N issues` frame nodes; singletons are packed into a single
  `Independent · N issues` frame (matching the issues.martonpaulo.com reference).
- **Layout**: dagre top-to-bottom per chain, chains packed vertically,
  independent issues in a grid (≤6 columns). Fixed card geometry
  (240×170) so dagre's positions stay truthful; frames are parent nodes
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

## Step 2 visual refinements (answered after first review)

- **Blocked must be instantly legible**: blocked cards get a red left accent
  strip and a top-right corner counter badge; edges pointing into a blocked
  issue are drawn red (blockers are always the sources). No manual "blocked"
  flag — state is data-driven; the point is immediate visual recognition.
- **Corner counter format**: `2` when both blockers are open, `1/2` when one of
  two is resolved (tooltip `N of M blockers open`), hidden when no blockers are
  open (the muted `N resolved blocker(s)` chip still shows full resolution).
- **Assignees**: up to two 16px avatars + `@handles` (truncated) + `+N` on the
  card; all avatars in the drawer; bold `Unassigned` when none.
- **Canvas feel (Excalidraw-inspired)**: wheel pans (`panOnScroll`, speed 0.6),
  pinch zooms, double-click zoom disabled, slightly larger dots, 200ms fitView.
  Svelte Flow stays the engine — Excalidraw itself was rejected (React runtime,
  drawing model instead of live data cards).
- **Testing note**: Svelte Flow measures nodes and runs fitView via
  requestAnimationFrame, so the canvas stays unmeasured while the desktop window
  is occluded. Verified via headless Chrome/CDP (`/tmp` script, no deps) —
  fixture covers all badge/avatar/accent/red-edge states.
- **Layout engine: ELK, not dagre** (review of real data showed overlapping
  smoothstep elbows and arrowhead pileups). ELK layered (direction DOWN,
  Brandes–Köpf placement) positions nodes only — edge routing is left to the
  official Svelte Flow "floating edges" pattern. ELK is loaded lazily.
- **Rounded orthogonal edges, bottom → top only (final geometry)**: ELK owns
  both node placement and edge routing (orthogonal, obstacle-aware with
  `spacing.edgeNode: 24`). Every card has one fixed bottom-center source port
  and one top-center target port. A custom `rounded` edge renders ELK's routed
  polyline with 7px rounded corners (`M`/`L`/`Q`), so arrows always leave the
  bottom-center, always enter the top-center, stay straight with soft bends,
  and never cross card bodies in laid-out graphs — verified geometrically with
  a headless test that intersects every edge polyline with every card rectangle
  (zero hits). Rigid moves (dragging a chain frame) translate the seeded route;
  individually dragged nodes use a bottom→top orthogonal fallback until
  Auto-Layout. This supersedes the floating-bezier experiment.
- **Themed canvas UI (official styles)**: `@xyflow/svelte/xy-theme.css` is
  imported in `layout.css` with the documented layer order
  (`@layer theme, base, xyflow, components, utilities;`), plus light-mode CSS
  variable overrides (edge stroke, dots, controls, minimap, handles). The
  canvas uses `forceColorMode="light"`, the official `<MiniMap>`
  (bottom-right, pannable/zoomable), `<Controls>`, and a `<Panel>` legend
  ("→ blocks") — the example-app look instead of hand-rolled chrome.
- **Native-only blocking relationships (latest decision)**: dependencies come
  exclusively from GitHub's issue **Relationships attribute** (GraphQL
  `Issue.blockedBy`, REST `dependencies/blocked_by`). Body text, task lists and
  labels are NOT parsed — real repos (niaefeup/tts, sveltejs/svelte) showed
  stale or prose-style mentions creating false and reversed edges. The text
  parser was removed entirely, along with task-list PR refs. Trade-offs:
  - Anonymous REST can only enumerate native relationships within the 60/hr
    budget (honest warnings; PAT recommended for complete graphs).
  - Repositories that don't use the Relationships attribute show no dependency
    edges; the board displays an explanatory hint in that case.
  - Old decisions about text parsing/label keywords/bare-noun exclusions are
    superseded and kept below only as history.
- **Content-sized cards**: card height is estimated per issue in `graph.ts`
  from the same row constants `IssueNode.svelte` renders with (header 18px,
  title ≤3 lines × 17px, labels 18px, milestone 15px, heat 15px, badges 18px,
  4px gaps, 20px padding) — no fixed height, no dead space, no clipped titles.
  Cards use `rounded-md` + `shadow-sm` to match the example aesthetic.
- **Selection clarity**: edges touching the selected issue are emphasized
  (red-800, 2.5px) and unrelated edges dim to 25% while a drawer is open.
