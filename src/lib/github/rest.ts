import { GithubError } from './errors';
import type {
	LinkedPR,
	IssueRecord,
	LoaderOptions,
	LoaderRateInfo,
	LoaderResult,
	NativeRelationships,
	ResolvedExternals
} from './types';

const API = 'https://api.github.com';

/**
 * Anonymous budget is 60 req/hr, so every phase here is capped.
 * Order of spend: repo info -> issues -> open PRs -> native relationships
 * -> linked-PR timeline scans -> referenced issue lookups (a shared budget
 * is reserved for the last phase, which runs after this loader returns).
 */
const MAX_ISSUE_PAGES = 5; // 500 issues
const MAX_OPEN_PR_PAGES = 3; // 300 open PRs
const MAX_SEARCH_PAGES = 2; // 200 blocked issues
const MAX_NATIVE_DEP_CALLS = 30;
const MAX_REF_LOOKUPS = 60;
/** Core-REST requests kept in reserve after the optional phases. */
const RATE_RESERVE = 3;
/** Hard cap on timeline scans; the remaining budget can lower this further. */
const TIMELINE_BUDGET = 30;

interface RestCtx {
	owner: string;
	repo: string;
	requestCount: number;
	rate: LoaderRateInfo | null;
	warnings: string[];
	progress?: (message: string) => void;
}

interface GhOptions {
	/**
	 * Search endpoints have their own rate budget; reading their rate headers
	 * would corrupt the core-REST view, so we skip it.
	 */
	searchRate?: boolean;
}

async function gh<T>(ctx: RestCtx, path: string, opts: GhOptions = {}): Promise<T> {
	ctx.requestCount++;
	const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
	let res: Response;
	try {
		res = await fetch(`${API}${path}`, { headers });
	} catch (err) {
		throw new GithubError('network', `Could not reach api.github.com: ${(err as Error).message}`);
	}
	if (!opts.searchRate) {
		const limit = res.headers.get('x-ratelimit-limit');
		const remaining = res.headers.get('x-ratelimit-remaining');
		const reset = res.headers.get('x-ratelimit-reset');
		if (limit !== null && remaining !== null) {
			ctx.rate = {
				limit: parseInt(limit, 10),
				remaining: parseInt(remaining, 10),
				resetAt: reset !== null ? new Date(parseInt(reset, 10) * 1000).toISOString() : null
			};
		}
	}
	if (res.status === 404) {
		throw new GithubError('not-found', `GitHub says ${path} does not exist.`, 404);
	}
	if (res.status === 401) {
		throw new GithubError('auth', 'GitHub rejected the request. Sign in again and retry.', 401);
	}
	if (res.status === 403 || res.status === 429) {
		if (ctx.rate && ctx.rate.remaining === 0) {
			throw new GithubError(
				'rate-limit',
				`GitHub rate limit exhausted (60 req/hr anonymous). Resets ${
					ctx.rate.resetAt ? new Date(ctx.rate.resetAt).toLocaleTimeString() : 'within the hour'
				}. Sign in with GitHub for 5,000 req/hr.`,
				403
			);
		}
		throw new GithubError(
			'rate-limit',
			'GitHub returned 403 (secondary rate limit or quota). Wait a minute and retry.',
			403
		);
	}
	if (!res.ok) {
		throw new GithubError(
			'unknown',
			`GitHub API error ${res.status} ${res.statusText}`,
			res.status
		);
	}
	const json: unknown = await res.json();
	return json as T;
}

function outOfBudget(ctx: RestCtx): boolean {
	return ctx.rate !== null && ctx.rate.remaining <= RATE_RESERVE;
}

// --- REST payload shapes (only what we read) ---

interface RestUser {
	node_id?: string;
	login: string;
	html_url: string;
	avatar_url: string;
}

interface RestLabel {
	node_id?: string;
	name: string;
	color: string | null;
}

interface RestMilestone {
	node_id?: string;
	number: number;
	title: string;
	state: 'open' | 'closed';
	due_on: string | null;
	open_issues?: number;
	closed_issues?: number;
}

interface RestReactions {
	total_count: number;
	'+1': number;
	'-1': number;
	laugh: number;
	hooray: number;
	confused: number;
	heart: number;
	rocket: number;
	eyes: number;
}

interface RestIssue {
	node_id?: string;
	number: number;
	title: string;
	state: 'open' | 'closed';
	html_url: string;
	body: string | null;
	user: RestUser | null;
	assignees: RestUser[] | null;
	labels: (RestLabel | string)[];
	milestone: RestMilestone | null;
	comments: number;
	reactions?: RestReactions;
	created_at: string;
	updated_at: string;
	closed_at: string | null;
	pull_request?: { merged_at: string | null } | null;
}

interface RestRepo {
	full_name: string;
	has_issues: boolean;
}

interface RestSearch {
	total_count: number;
	items: RestIssue[];
}

interface RestTimelineItem {
	event: string | null;
	source?: { issue?: RestIssue | null } | null;
}

interface RestPull {
	number: number;
	title: string;
	html_url: string;
	state: 'open' | 'closed';
	draft: boolean | null;
	user: RestUser | null;
	merged_at: string | null;
	body: string | null;
}

// --- mappers ---

function milestoneProgress(milestone: RestMilestone): number {
	const open = milestone.open_issues ?? 0;
	const closed = milestone.closed_issues ?? 0;
	const total = open + closed;
	return total > 0 ? Math.round((closed / total) * 100) : 0;
}

function mapRestIssue(raw: RestIssue, inScope: boolean): IssueRecord {
	return {
		id: raw.node_id ?? '',
		number: raw.number,
		title: raw.title,
		state: raw.state,
		url: raw.html_url,
		body: raw.body ?? '',
		author: raw.user?.login ?? null,
		createdAt: raw.created_at,
		updatedAt: raw.updated_at,
		closedAt: raw.closed_at,
		assignees: (raw.assignees ?? []).map((u) => ({
			id: u.node_id ?? '',
			login: u.login,
			url: u.html_url,
			avatarUrl: u.avatar_url
		})),
		labels: raw.labels.map((l) =>
			typeof l === 'string'
				? { id: '', name: l, color: '' }
				: { id: l.node_id ?? '', name: l.name, color: l.color ?? '' }
		),
		milestone: raw.milestone
			? {
					id: raw.milestone.node_id ?? '',
					number: raw.milestone.number,
					title: raw.milestone.title,
					state: raw.milestone.state,
					dueOn: raw.milestone.due_on,
					progressPercentage: milestoneProgress(raw.milestone)
				}
			: null,
		comments: raw.comments,
		reactions: raw.reactions
			? {
					total: raw.reactions.total_count,
					counts: {
						plusOne: raw.reactions['+1'],
						minusOne: raw.reactions['-1'],
						laugh: raw.reactions.laugh,
						hooray: raw.reactions.hooray,
						confused: raw.reactions.confused,
						heart: raw.reactions.heart,
						rocket: raw.reactions.rocket,
						eyes: raw.reactions.eyes
					}
				}
			: null,
		blockedBy: [],
		blocks: [],
		linkedPRs: [],
		inScope,
		prScan: 'none'
	};
}

/** Build a PR record from an issue-shaped payload (PRs share the issue schema). */
function prFromIssueShape(raw: RestIssue, owner: string, repo: string): LinkedPR | null {
	if (!raw.pull_request) return null;
	const mergedAt = raw.pull_request.merged_at ?? null;
	const merged = mergedAt !== null;
	const sameRepo = raw.html_url
		.toLowerCase()
		.startsWith(`https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}/pull/`);
	return {
		number: raw.number,
		title: raw.title,
		url: raw.html_url,
		state: raw.state === 'open' ? 'open' : merged ? 'merged' : 'closed',
		draft: null,
		author: raw.user?.login ?? null,
		mergedAt,
		mergeStateUnknown: raw.state === 'closed' && raw.pull_request.merged_at === undefined,
		crossRepository: !sameRepo
	};
}

function mapRestPull(raw: RestPull): LinkedPR {
	return {
		number: raw.number,
		title: raw.title,
		url: raw.html_url,
		state: raw.merged_at ? 'merged' : raw.state,
		draft: raw.draft ?? false,
		author: raw.user?.login ?? null,
		mergedAt: raw.merged_at,
		mergeStateUnknown: false,
		crossRepository: false
	};
}

/** Closing keywords as GitHub defines them, with comma-separated ref lists. */
const CLOSING_REF =
	/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*(#\d{1,7}(?:\s*,\s*#\d{1,7})*)/gi;

export function closingRefsIn(body: string | null): number[] {
	if (!body) return [];
	const out: number[] = [];
	let m: RegExpExecArray | null;
	CLOSING_REF.lastIndex = 0;
	while ((m = CLOSING_REF.exec(body))) {
		for (const ref of m[1].matchAll(/#(\d{1,7})/g)) out.push(parseInt(ref[1], 10));
	}
	return out;
}

async function paged<T>(
	ctx: RestCtx,
	firstPath: string,
	maxPages: number,
	label: string
): Promise<T[]> {
	const out: T[] = [];
	for (let page = 1; page <= maxPages; page++) {
		const sep = firstPath.includes('?') ? '&' : '?';
		const items = await gh<T[]>(ctx, `${firstPath}${sep}per_page=100&page=${page}`);
		out.push(...items);
		ctx.progress?.(`${label}: ${out.length} loaded`);
		if (items.length < 100) return out;
	}
	ctx.warnings.push(`${label}: stopped at the ${maxPages * 100} item cap.`);
	return out;
}

export async function loadRepoViaRest(
	owner: string,
	repo: string,
	opts: LoaderOptions
): Promise<LoaderResult> {
	const ctx: RestCtx = {
		owner,
		repo,
		requestCount: 0,
		rate: null,
		warnings: [],
		progress: opts.progress
	};

	// 1. Repository info: validates the repo exists and gives the canonical name.
	ctx.progress?.('Fetching repository info…');
	let repoInfo: RestRepo;
	try {
		repoInfo = await gh<RestRepo>(ctx, `/repos/${owner}/${repo}`);
	} catch (err) {
		if (err instanceof GithubError && err.kind === 'not-found') {
			throw new GithubError(
				'not-found',
				`Repository ${owner}/${repo} not found. If it is private, sign in with GitHub and allow private repository access.`
			);
		}
		throw err;
	}
	if (repoInfo.has_issues === false) {
		throw new GithubError('not-found', `${repoInfo.full_name} has issues disabled.`);
	}
	// The IP's anonymous quota may already be drained by other apps: bail out
	// early with a clean message instead of burning the remaining calls.
	if (ctx.rate !== null && ctx.rate.remaining <= RATE_RESERVE) {
		throw new GithubError(
			'rate-limit',
			`GitHub rate limit nearly exhausted (${ctx.rate.remaining}/${ctx.rate.limit} left).` +
				` Resets ${
					ctx.rate.resetAt ? new Date(ctx.rate.resetAt).toLocaleTimeString() : 'within the hour'
				}. Sign in with GitHub for 5,000 req/hr.`,
			403
		);
	}

	// 2. Issues (PRs are mixed in and filtered out; they are fetched separately).
	ctx.progress?.('Fetching issues…');
	const rawIssues = await paged<RestIssue>(
		ctx,
		`/repos/${owner}/${repo}/issues?state=${opts.scope}&sort=updated&direction=desc`,
		MAX_ISSUE_PAGES,
		'Issues'
	);
	const issues = rawIssues.filter((i) => !i.pull_request).map((i) => mapRestIssue(i, true));

	// 3. Open PRs (draft state included) + cheap closing-keyword pass over their bodies.
	ctx.progress?.('Fetching open pull requests…');
	const rawOpenPrs = await paged<RestPull>(
		ctx,
		`/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc`,
		MAX_OPEN_PR_PAGES,
		'Open PRs'
	);
	const prs = new Map<number, LinkedPR>();
	for (const pr of rawOpenPrs) prs.set(pr.number, mapRestPull(pr));
	const prLinks = new Map<number, number[]>(); // issue number -> PR numbers
	for (const pr of rawOpenPrs) {
		for (const target of closingRefsIn(pr.body)) {
			if (target === pr.number) continue;
			const list = prLinks.get(target) ?? [];
			if (!list.includes(pr.number)) list.push(pr.number);
			prLinks.set(target, list);
		}
	}
	function applyPrLinks(issue: IssueRecord): void {
		const linked = prLinks.get(issue.number);
		if (linked) {
			issue.linkedPRs = linked
				.map((n) => prs.get(n))
				.filter((p): p is LinkedPR => p !== undefined)
				.sort((a, b) => a.number - b.number);
		}
		issue.prScan = 'bodies-only';
	}
	for (const issue of issues) applyPrLinks(issue);

	// 4. GitHub-native "blocked by" relationships, discovered via search.
	const nativeBlockedBy = new Map<number, number[]>();
	const extraIssues = new Map<number, IssueRecord>();
	let nativeRelationships: NativeRelationships = 'skipped';
	if (outOfBudget(ctx)) {
		ctx.warnings.push(
			'Rate budget too low to check GitHub-native relationships (sign in with GitHub for full data).'
		);
	} else {
		try {
			ctx.progress?.('Checking native issue relationships…');
			const blockedItems: RestIssue[] = [];
			const q = encodeURIComponent(`repo:${owner}/${repo} is:blocked is:issue`);
			for (let page = 1; page <= MAX_SEARCH_PAGES; page++) {
				const search = await gh<RestSearch>(
					ctx,
					`/search/issues?q=${q}&per_page=100&page=${page}`,
					{
						searchRate: true
					}
				);
				blockedItems.push(...search.items);
				if (search.items.length < 100) break;
			}
			if (blockedItems.length > MAX_NATIVE_DEP_CALLS) {
				ctx.warnings.push(
					`${blockedItems.length} issues have native "blocked by" relationships; only the first ` +
						`${MAX_NATIVE_DEP_CALLS} were enumerated (sign in with GitHub for full data).`
				);
			}
			let exhausted = false;
			for (const item of blockedItems.slice(0, MAX_NATIVE_DEP_CALLS)) {
				if (outOfBudget(ctx)) {
					exhausted = true;
					break;
				}
				const blockers = await gh<RestIssue[]>(
					ctx,
					`/repos/${owner}/${repo}/issues/${item.number}/dependencies/blocked_by?per_page=100`
				);
				nativeBlockedBy.set(
					item.number,
					blockers.map((b) => b.number)
				);
				// Both the blocked issue and its blockers may be out of scope
				// (e.g. closed issues while in open-only mode): keep full records.
				if (!issues.some((i) => i.number === item.number) && !extraIssues.has(item.number)) {
					const record = mapRestIssue(item, false);
					applyPrLinks(record);
					extraIssues.set(item.number, record);
				}
				for (const b of blockers) {
					if (!issues.some((i) => i.number === b.number) && !extraIssues.has(b.number)) {
						const record = mapRestIssue(b, false);
						applyPrLinks(record);
						extraIssues.set(b.number, record);
					}
				}
			}
			nativeRelationships = exhausted ? 'skipped' : 'used';
			if (exhausted) {
				ctx.warnings.push(
					'Stopped enumerating native relationships (rate budget; sign in with GitHub for complete data).'
				);
			}
		} catch (err) {
			if (err instanceof GithubError && err.kind === 'rate-limit') {
				ctx.warnings.push(
					'Skipped native issue relationships (rate limit). Sign in with GitHub for complete data.'
				);
			} else {
				ctx.warnings.push('Could not read GitHub-native relationships; using text parsing only.');
				nativeRelationships = 'unavailable';
			}
		}
	}

	// 5. Timeline scans for issues without links yet: catches manually linked
	// and already-closed PRs. Budget-aware, most recently updated first.
	const timelineBudget = Math.max(0, Math.min(TIMELINE_BUDGET, 35 - ctx.requestCount));
	let scanned = 0;
	for (const issue of issues) {
		if (scanned >= timelineBudget || outOfBudget(ctx)) break;
		if (issue.linkedPRs.length > 0) continue; // body pass already linked PRs
		try {
			const timeline = await gh<RestTimelineItem[]>(
				ctx,
				`/repos/${owner}/${repo}/issues/${issue.number}/timeline?per_page=100`
			);
			scanned++;
			issue.prScan = 'full';
			for (const item of timeline) {
				const src = item.event === 'connected' ? item.source?.issue : undefined;
				if (!src) continue;
				const pr = prs.get(src.number) ?? prFromIssueShape(src, owner, repo);
				if (!pr) continue; // connected to another issue (sub-issue), not a PR
				prs.set(pr.number, pr);
				if (!issue.linkedPRs.some((p) => p.number === pr.number)) issue.linkedPRs.push(pr);
			}
		} catch (err) {
			if (err instanceof GithubError && err.kind === 'rate-limit') {
				ctx.warnings.push(`Timeline scans stopped after ${scanned} issues (rate limit).`);
				break;
			}
			// A single failing timeline should not sink the whole load.
		}
	}
	const unscanned = issues.filter((i) => i.prScan !== 'full').length;
	if (unscanned > 0 && timelineBudget > 0) {
		ctx.warnings.push(
			`Linked-PR data for ${unscanned} issues relies on open-PR bodies only ` +
				`(anonymous rate budget). Sign in with GitHub for complete data.`
		);
	}

	// 6. Closure used by the orchestrator to resolve text-referenced numbers.
	const resolveExternals = async (numbers: number[]): Promise<ResolvedExternals> => {
		const foundIssues: IssueRecord[] = [];
		const foundPrs: LinkedPR[] = [];
		const missing: number[] = [];
		if (!numbers.length) return { issues: foundIssues, prs: foundPrs, missing };
		const capped = numbers.slice(0, MAX_REF_LOOKUPS);
		if (numbers.length > MAX_REF_LOOKUPS) {
			ctx.warnings.push(
				`Referenced issue lookups capped at ${MAX_REF_LOOKUPS} (sign in with GitHub for the rest).`
			);
		}
		for (const n of capped) {
			if (outOfBudget(ctx)) {
				missing.push(n);
				continue;
			}
			try {
				const issue = await gh<RestIssue>(ctx, `/repos/${owner}/${repo}/issues/${n}`);
				if (issue.pull_request) {
					// A task list pointed at a PR: record it as a PR reference.
					const pr = prFromIssueShape(issue, owner, repo);
					if (pr) foundPrs.push(pr);
				} else {
					const record = mapRestIssue(issue, false);
					applyPrLinks(record);
					foundIssues.push(record);
				}
			} catch (err) {
				if (err instanceof GithubError && err.kind === 'not-found') {
					missing.push(n);
				} else if (err instanceof GithubError && err.kind === 'rate-limit') {
					missing.push(n);
				} else {
					throw err;
				}
			}
		}
		return { issues: foundIssues, prs: foundPrs, missing };
	};

	const snapshot = () => ({ requestCount: ctx.requestCount, rate: ctx.rate });

	return {
		nameWithOwner: repoInfo.full_name,
		issues,
		extraIssues: [...extraIssues.values()],
		prs: [...prs.values()],
		nativeBlockedBy,
		totalIssues: null,
		truncated: rawIssues.length >= MAX_ISSUE_PAGES * 100,
		warnings: ctx.warnings,
		prLinkDetection: `open-PR closing keywords + ${scanned} issue timelines scanned (anonymous REST)`,
		nativeRelationships,
		resolveExternals,
		snapshot
	};
}
