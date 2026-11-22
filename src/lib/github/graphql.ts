import { resolve } from '$app/paths';
import { GithubError } from './errors';
import type {
	LinkedPR,
	IssueRecord,
	LoaderOptions,
	LoaderRateInfo,
	LoaderResult,
	ReactionType,
	ResolvedExternals
} from './types';

const GITHUB_GRAPHQL_PROXY = resolve('/api/github/graphql');
const MAX_PAGES = 5; // 500 issues
const EXTERNAL_CHUNK = 50;
const MAX_EXTERNAL_CHUNKS = 3;

interface GqlCtx {
	requestCount: number;
	warnings: string[];
	progress?: (message: string) => void;
	rate: LoaderRateInfo | null;
}

interface GqlErrorLike {
	message: string;
}

interface GqlResponse<T> {
	data?: T | null;
	errors?: GqlErrorLike[];
}

async function gql<T>(
	ctx: GqlCtx,
	query: string,
	variables: Record<string, unknown>,
	opts: { tolerateMissing?: boolean } = {}
): Promise<T> {
	ctx.requestCount++;
	let res: Response;
	try {
		res = await fetch(GITHUB_GRAPHQL_PROXY, {
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ query, variables })
		});
	} catch (err) {
		throw new GithubError('network', `Could not reach GitHub: ${(err as Error).message}`);
	}
	if (res.status === 401) {
		throw new GithubError(
			'auth',
			'Your GitHub session has expired. Sign in again to continue.',
			401
		);
	}
	if (res.status === 403 || res.status === 429) {
		throw new GithubError(
			'rate-limit',
			'GitHub GraphQL rate limit exceeded. Try again later.',
			403
		);
	}
	if (!res.ok) {
		throw new GithubError(
			'unknown',
			`GitHub GraphQL error ${res.status} ${res.statusText}`,
			res.status
		);
	}
	const raw: unknown = await res.json();
	const json = raw as GqlResponse<T>;
	if (json.errors?.length) {
		if (json.data === undefined || json.data === null) {
			throw new GithubError('unknown', `GitHub GraphQL: ${json.errors[0].message}`);
		}
		// In the two-phase external lookup, "Could not resolve to an Issue/PullRequest
		// with the number of X" is the expected signal for a null alias, not a problem.
		const relevant = opts.tolerateMissing
			? json.errors.filter(
					(e) => !/Could not resolve to an? \w+ with the number of/i.test(e.message)
				)
			: json.errors;
		for (const err of relevant) {
			ctx.warnings.push(`GitHub GraphQL partial error: ${err.message}`);
		}
	}
	if (json.data === undefined || json.data === null) {
		throw new GithubError('unknown', 'GitHub GraphQL returned no data.');
	}
	return json.data;
}

// --- GraphQL payload shapes (only what we read) ---

interface GqlActor {
	login: string;
}

interface GqlUserNode {
	login: string;
	url: string;
	avatarUrl: string;
}

interface GqlLabel {
	name: string;
	color: string;
}

interface GqlMilestone {
	number: number;
	title: string;
	state: 'OPEN' | 'CLOSED';
	dueOn: string | null;
}

interface GqlReactionGroup {
	content: string;
	users: { totalCount: number };
}

interface GqlPull {
	number: number;
	title: string;
	url: string;
	state: 'OPEN' | 'CLOSED' | 'MERGED';
	isDraft: boolean | null;
	mergedAt: string | null;
	author: GqlActor | null;
}

interface GqlIssue {
	number: number;
	title: string;
	url: string;
	state: 'OPEN' | 'CLOSED';
	body: string | null;
	author: GqlActor | null;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
	assignees: { nodes: GqlUserNode[] } | null;
	labels: { nodes: GqlLabel[] } | null;
	milestone: GqlMilestone | null;
	comments: { totalCount: number };
	reactions: { totalCount: number };
	reactionGroups: GqlReactionGroup[] | null;
	blockedBy: { totalCount: number; nodes: { number: number }[] } | null;
	closedByPullRequestsReferences: { totalCount: number; nodes: GqlPull[] } | null;
}

interface GqlIssuesPage {
	totalCount: number;
	pageInfo: { hasNextPage: boolean; endCursor: string | null };
	nodes: GqlIssue[] | null;
}

interface MainData {
	rateLimit: { cost: number; limit: number; remaining: number; resetAt: string } | null;
	repository: {
		nameWithOwner: string;
		issues: GqlIssuesPage;
	} | null;
}

const REACTION_CONTENT: Record<string, ReactionType> = {
	THUMBS_UP: 'plusOne',
	THUMBS_DOWN: 'minusOne',
	LAUGH: 'laugh',
	HOORAY: 'hooray',
	CONFUSED: 'confused',
	HEART: 'heart',
	ROCKET: 'rocket',
	EYES: 'eyes'
};

const ISSUE_CORE = `
	number title url state body
	createdAt updatedAt closedAt
	author { login }
	assignees(first: 10) { nodes { login url avatarUrl } }
	labels(first: 20) { nodes { name color } }
	milestone { number title state dueOn }
	comments { totalCount }
	reactions { totalCount }
	reactionGroups { content users { totalCount } }
`;

const PR_CORE = `
	number title url state isDraft mergedAt author { login }
`;

const MAIN_QUERY = `
	query RepoIssues($owner: String!, $repo: String!, $states: [IssueState!], $cursor: String) {
		rateLimit { cost limit remaining resetAt }
		repository(owner: $owner, name: $repo) {
			nameWithOwner
			issues(
				first: 100
				after: $cursor
				states: $states
				orderBy: { field: UPDATED_AT, direction: DESC }
			) {
				totalCount
				pageInfo { hasNextPage endCursor }
				nodes {
					${ISSUE_CORE}
					blockedBy(first: 50) { totalCount nodes { number } }
					closedByPullRequestsReferences(includeClosedPrs: true, first: 20) {
						totalCount
						nodes { ${PR_CORE} }
					}
				}
			}
		}
	}
`;

/** Aliased per-number lookups for issues (or PRs) referenced from text. */
function externalsQuery(kind: 'issue' | 'pullRequest', numbers: number[]): string {
	const isIssue = kind === 'issue';
	const parts = numbers.map((n, i) => `x${i}: ${kind}(number: ${n}) { ...X }`);
	return (
		`query($owner: String!, $repo: String!) { ` +
		`repository(owner: $owner, name: $repo) { ${parts.join(' ')} } } ` +
		`fragment X on ${isIssue ? 'Issue' : 'PullRequest'} { ${isIssue ? ISSUE_CORE : PR_CORE} }`
	);
}

function mapGqlPull(node: GqlPull, owner: string, repo: string): LinkedPR {
	// Cross-repository means the PR lives in a different repository than the
	// board (e.g. a fork's own PR linked to this repo's issue) — NOT GitHub's
	// `isCrossRepository`, which merely means the PR's head branch is a fork.
	const expectedUrl = `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}/pull/`;
	return {
		number: node.number,
		title: node.title,
		url: node.url,
		state: node.state === 'MERGED' ? 'merged' : node.state === 'OPEN' ? 'open' : 'closed',
		draft: node.isDraft ?? false,
		author: node.author?.login ?? null,
		mergedAt: node.mergedAt,
		mergeStateUnknown: false,
		crossRepository: !node.url.toLowerCase().startsWith(expectedUrl)
	};
}

function mapGqlIssue(node: GqlIssue, inScope: boolean, owner: string, repo: string): IssueRecord {
	const counts: Partial<Record<ReactionType, number>> = {};
	for (const group of node.reactionGroups ?? []) {
		const key = REACTION_CONTENT[group.content];
		if (key) counts[key] = group.users.totalCount;
	}
	return {
		number: node.number,
		title: node.title,
		state: node.state === 'OPEN' ? 'open' : 'closed',
		url: node.url,
		body: node.body ?? '',
		author: node.author?.login ?? null,
		createdAt: node.createdAt,
		updatedAt: node.updatedAt,
		closedAt: node.closedAt,
		assignees: (node.assignees?.nodes ?? []).map((u) => ({
			login: u.login,
			url: u.url,
			avatarUrl: u.avatarUrl
		})),
		labels: (node.labels?.nodes ?? []).map((l) => ({ name: l.name, color: l.color })),
		milestone: node.milestone
			? {
					number: node.milestone.number,
					title: node.milestone.title,
					state: node.milestone.state === 'OPEN' ? 'open' : 'closed',
					dueOn: node.milestone.dueOn
				}
			: null,
		comments: node.comments.totalCount,
		reactions: { total: node.reactions.totalCount, counts },
		blockedBy: (node.blockedBy?.nodes ?? []).map((n) => ({ number: n.number, source: 'native' })),
		blocks: [],
		linkedPRs: (node.closedByPullRequestsReferences?.nodes ?? []).map((pr) =>
			mapGqlPull(pr, owner, repo)
		),
		inScope,
		prScan: 'full'
	};
}

export async function loadRepoViaGraphQL(
	owner: string,
	repo: string,
	opts: LoaderOptions
): Promise<LoaderResult> {
	const ctx: GqlCtx = {
		requestCount: 0,
		warnings: [],
		progress: opts.progress,
		rate: null
	};
	const states: string[] | null = opts.scope === 'open' ? ['OPEN'] : null;

	const issues: IssueRecord[] = [];
	const nativeBlockedBy = new Map<number, number[]>();
	const prs = new Map<number, LinkedPR>();
	let totalCount: number | null = null;
	let nameWithOwner: string | null = null;
	let cursor: string | null = null;

	for (let page = 1; page <= MAX_PAGES; page++) {
		ctx.progress?.(`Fetching issues via GraphQL (page ${page})…`);
		const data: MainData = await gql<MainData>(ctx, MAIN_QUERY, { owner, repo, states, cursor });
		if (!data.repository) {
			throw new GithubError(
				'not-found',
				`Repository ${owner}/${repo} not found, or your GitHub account cannot see it.`,
				404
			);
		}
		nameWithOwner = data.repository.nameWithOwner;
		totalCount = data.repository.issues.totalCount;
		if (data.rateLimit) {
			ctx.rate = {
				limit: data.rateLimit.limit,
				remaining: data.rateLimit.remaining,
				resetAt: data.rateLimit.resetAt
			};
		}
		for (const node of data.repository.issues.nodes ?? []) {
			const record = mapGqlIssue(node, true, owner, repo);
			issues.push(record);
			if (node.blockedBy?.nodes.length) {
				nativeBlockedBy.set(
					node.number,
					node.blockedBy.nodes.map((n) => n.number)
				);
			}
			for (const pr of record.linkedPRs) prs.set(pr.number, pr);
			const prTotal = node.closedByPullRequestsReferences?.totalCount ?? 0;
			if (prTotal > 20) {
				ctx.warnings.push(`Issue #${node.number} has ${prTotal} linked PRs; keeping the first 20.`);
			}
		}
		if (!data.repository.issues.pageInfo.hasNextPage) break;
		cursor = data.repository.issues.pageInfo.endCursor;
	}

	const truncated = totalCount !== null && totalCount > issues.length;
	if (truncated) {
		ctx.warnings.push(
			`Repository has ${totalCount} issues in scope; showing the ${issues.length} most recently updated (cap).`
		);
	}

	const resolveExternals = async (numbers: number[]): Promise<ResolvedExternals> => {
		const foundIssues: IssueRecord[] = [];
		const foundPrs: LinkedPR[] = [];
		const missing: number[] = [];
		if (!numbers.length) return { issues: foundIssues, prs: foundPrs, missing };
		const capped = numbers.slice(0, EXTERNAL_CHUNK * MAX_EXTERNAL_CHUNKS);
		if (numbers.length > capped.length) {
			ctx.warnings.push(
				`${numbers.length - capped.length} referenced numbers were not resolved (cap reached).`
			);
		}
		// Phase 1: alias-batched issue lookups.
		const notIssues: number[] = [];
		for (let i = 0; i < capped.length; i += EXTERNAL_CHUNK) {
			const chunk = capped.slice(i, i + EXTERNAL_CHUNK);
			ctx.progress?.(`Resolving referenced issues (${i + chunk.length}/${capped.length})…`);
			const data = await gql<{ repository: Record<string, GqlIssue | null> | null }>(
				ctx,
				externalsQuery('issue', chunk),
				{ owner, repo },
				{ tolerateMissing: true }
			);
			chunk.forEach((n, idx) => {
				const hit = data.repository?.[`x${idx}`] ?? null;
				if (hit) foundIssues.push(mapGqlIssue(hit, false, owner, repo));
				else notIssues.push(n);
			});
		}
		// Phase 2: numbers that were not issues may be PRs.
		for (let i = 0; i < notIssues.length; i += EXTERNAL_CHUNK) {
			const chunk = notIssues.slice(i, i + EXTERNAL_CHUNK);
			const data = await gql<{ repository: Record<string, GqlPull | null> | null }>(
				ctx,
				externalsQuery('pullRequest', chunk),
				{ owner, repo },
				{ tolerateMissing: true }
			);
			chunk.forEach((n, idx) => {
				const hit = data.repository?.[`x${idx}`] ?? null;
				if (hit) foundPrs.push(mapGqlPull(hit, owner, repo));
				else missing.push(n);
			});
		}
		return { issues: foundIssues, prs: foundPrs, missing };
	};

	const snapshot = () => ({ requestCount: ctx.requestCount, rate: ctx.rate });

	return {
		nameWithOwner,
		issues,
		extraIssues: [],
		prs: [...prs.values()],
		nativeBlockedBy,
		totalIssues: totalCount,
		truncated,
		warnings: ctx.warnings,
		prLinkDetection: 'GraphQL closedByPullRequestsReferences (complete, incl. manually linked PRs)',
		nativeRelationships: 'used',
		resolveExternals,
		snapshot
	};
}
