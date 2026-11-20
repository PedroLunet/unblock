/** Domain types for the GitHub data layer. */

export type FetchScope = 'open' | 'all';

export type IssueState = 'open' | 'closed';

/** PR state as we display it: "merged" is surfaced separately from closed-unmerged. */
export type LinkedPRState = 'open' | 'merged' | 'closed';

/** Where a dependency reference came from. */
export type DepSource = 'text' | 'tasklist' | 'native';

/**
 * How thorough linked-PR detection was for an issue:
 * - 'full': complete (GraphQL `closedByPullRequestsReferences`, or REST timeline scan)
 * - 'bodies-only': anonymous REST could only match closing keywords in open PR bodies;
 *   manually linked or already-closed PRs may be missing
 * - 'none': nothing was scanned (rate budget exhausted before this issue)
 */
export type PRScan = 'full' | 'bodies-only' | 'none';

export interface GitHubUser {
	login: string;
	url: string;
	avatarUrl: string;
}

export interface LabelInfo {
	name: string;
	color: string;
}

export interface MilestoneInfo {
	number: number;
	title: string;
	state: 'open' | 'closed';
	dueOn: string | null;
}

export type ReactionType =
	'plusOne' | 'minusOne' | 'laugh' | 'hooray' | 'confused' | 'heart' | 'rocket' | 'eyes';

export interface ReactionSummary {
	total: number;
	counts: Partial<Record<ReactionType, number>>;
}

export interface LinkedPR {
	number: number;
	title: string;
	url: string;
	state: LinkedPRState;
	/** null when unknown (e.g. a PR glimpsed through a REST issue-shaped payload). */
	draft: boolean | null;
	author: string | null;
	mergedAt: string | null;
	/** true when we know it is closed but could not tell merged from closed-unmerged. */
	mergeStateUnknown: boolean;
	/** true when the PR lives in a different repository (e.g. a fork's PR linked to this issue). */
	crossRepository: boolean;
}

/** A dependency reference parsed from text, task lists, or the GitHub-native API. */
export interface DependencyRef {
	number: number;
	source: DepSource;
}

export interface IssueRecord {
	number: number;
	title: string;
	state: IssueState;
	url: string;
	body: string;
	author: string | null;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
	assignees: GitHubUser[];
	labels: LabelInfo[];
	milestone: MilestoneInfo | null;
	comments: number;
	/** null when the API response did not include reaction data. */
	reactions: ReactionSummary | null;
	/** This issue cannot start until these numbers are resolved. */
	blockedBy: DependencyRef[];
	/** These issues cannot start until this one is resolved. */
	blocks: DependencyRef[];
	/** PRs formally connected as closing this issue (Closes/Fixes #n or manual link). */
	linkedPRs: LinkedPR[];
	/** False when the issue was resolved only because something referenced it (e.g. a closed blocker in open-only mode). */
	inScope: boolean;
	prScan: PRScan;
}

/** A directional dependency edge: `from` blocks `to`. */
export interface DepEdge {
	from: number;
	to: number;
	source: DepSource;
}

export type NativeRelationships = 'used' | 'skipped' | 'unavailable';

export interface RepoMeta {
	nameWithOwner: string | null;
	scope: FetchScope;
	source: 'rest' | 'graphql';
	requestCount: number;
	rateLimit: {
		limit: number;
		remaining: number;
		resetAt: string | null;
	} | null;
	/** Total issues matching the scope, when known (GraphQL). */
	totalIssues: number | null;
	truncatedIssues: boolean;
	prLinkDetection: string;
	nativeRelationships: NativeRelationships;
	warnings: string[];
	fetchDurationMs: number;
	fetchedAt: string;
	fromCache: boolean;
}

export interface RepoData {
	owner: string;
	repo: string;
	scope: FetchScope;
	/** Issues inside the current fetch scope. */
	issues: IssueRecord[];
	/** Out-of-scope issues resolved because an in-scope issue references them. */
	referencedIssues: IssueRecord[];
	/** Blocker -> blocked edges between issue numbers we have records for. */
	edges: DepEdge[];
	/** Every PR we know about, keyed by number. */
	prs: Record<number, LinkedPR>;
	meta: RepoMeta;
}

export type RefResolution =
	{ kind: 'issue'; issue: IssueRecord } | { kind: 'pr'; pr: LinkedPR } | { kind: 'missing' };

/** What a loader (REST or GraphQL) hands back to the orchestrator. */
export interface LoaderRateInfo {
	limit: number;
	remaining: number;
	resetAt: string | null;
}

export interface ResolvedExternals {
	issues: IssueRecord[];
	prs: LinkedPR[];
	missing: number[];
}

export interface LoaderSnapshot {
	requestCount: number;
	rate: LoaderRateInfo | null;
}

export interface LoaderResult {
	nameWithOwner: string | null;
	/** Issues inside the fetch scope. */
	issues: IssueRecord[];
	/** Out-of-scope issue records discovered during native-relationship fetching. */
	extraIssues: IssueRecord[];
	prs: LinkedPR[];
	/** issue number -> native "blocked by" numbers. */
	nativeBlockedBy: Map<number, number[]>;
	totalIssues: number | null;
	truncated: boolean;
	warnings: string[];
	prLinkDetection: string;
	nativeRelationships: NativeRelationships;
	/** Resolve issue numbers referenced from text but not in the fetched set. */
	resolveExternals: (numbers: number[]) => Promise<ResolvedExternals>;
	/** Live counters, read again after `resolveExternals` has run. */
	snapshot: () => LoaderSnapshot;
}

export interface LoaderOptions {
	scope: FetchScope;
	progress?: (message: string) => void;
}
