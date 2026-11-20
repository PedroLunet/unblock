import { loadRepoViaGraphQL } from './graphql';
import { dedupeRefs, parseDependencies } from './parse-deps';
import { loadRepoViaRest } from './rest';
import { readRepoCache, repoCacheKey, writeRepoCache } from './storage';
import type {
	DepEdge,
	DependencyRef,
	FetchScope,
	IssueRecord,
	LinkedPR,
	RefResolution,
	RepoData,
	ResolvedExternals
} from './types';

export type * from './types';
export { GithubError } from './errors';
export type { GithubErrorKind } from './errors';
export { parseRepoInput } from './input';
export type { RepoTarget } from './input';
export { clearPat, loadPat, maskPat, savePat } from './storage';

export interface LoadRepoOptions {
	/** Optional read-only GitHub PAT (stored in localStorage by the caller). */
	token: string | null;
	scope: FetchScope;
	/** Skip the 5-minute cache and force a refetch. */
	refresh?: boolean;
	progress?: (message: string) => void;
}

const EDGE_PRIORITY: Record<DependencyRef['source'], number> = {
	native: 3,
	text: 2,
	tasklist: 1
};

/**
 * Load a repository's issues, dependency edges and linked PRs.
 * Uses GraphQL when a PAT is provided, capped anonymous REST otherwise.
 * Results are cached in localStorage for 5 minutes (bypass with `refresh`).
 */
export async function loadRepo(
	owner: string,
	repo: string,
	options: LoadRepoOptions
): Promise<RepoData> {
	const key = repoCacheKey(owner, repo, options.scope, options.token !== null);
	if (!options.refresh) {
		const cached = readRepoCache(key);
		if (cached) return cached;
	}

	const started = Date.now();
	const loaderOptions = { scope: options.scope, progress: options.progress };
	const loader = options.token
		? await loadRepoViaGraphQL(owner, repo, options.token, loaderOptions)
		: await loadRepoViaRest(owner, repo, loaderOptions);

	const issues = loader.issues;
	const extraIssues: IssueRecord[] = [];
	const known = new Map<number, IssueRecord>();
	for (const issue of issues) known.set(issue.number, issue);
	for (const extra of loader.extraIssues) {
		if (!known.has(extra.number)) {
			extraIssues.push(extra);
			known.set(extra.number, extra);
		}
	}
	const prs: Record<number, LinkedPR> = {};
	for (const pr of loader.prs) prs[pr.number] = pr;

	// Native relationships are curated truth: a text-derived edge pointing the
	// opposite way of a native pair is stale prose and must never flip it
	// (e.g. a body saying "blocked by #x" while GitHub says this issue blocks #x).
	const nativePairs = new Set<string>();
	for (const [blocked, blockers] of loader.nativeBlockedBy) {
		for (const blocker of blockers) nativePairs.add(`${blocker}->${blocked}`);
	}

	// Parse dependency references from every issue body we have
	// (in-scope and referenced), then merge in native relationships.
	options.progress?.('Parsing dependencies from issue bodies…');
	const blockedByByNumber = new Map<number, DependencyRef[]>();
	const blocksByNumber = new Map<number, DependencyRef[]>();
	for (const issue of known.values()) {
		const parsed = parseDependencies(issue.body, issue.number, owner, repo);
		const native = (loader.nativeBlockedBy.get(issue.number) ?? []).map((n) => ({
			number: n,
			source: 'native' as const
		}));
		const textBlocked = parsed.blockedBy.filter(
			(ref) => !nativePairs.has(`${issue.number}->${ref.number}`)
		);
		const textBlocks = parsed.blocks.filter(
			(ref) => !nativePairs.has(`${ref.number}->${issue.number}`)
		);
		blockedByByNumber.set(issue.number, dedupeRefs([...native, ...textBlocked]));
		blocksByNumber.set(issue.number, textBlocks);
	}

	// Numbers referenced from text that we do not know yet.
	const unresolved = new Set<number>();
	for (const refs of blockedByByNumber.values()) {
		for (const ref of refs) {
			if (!known.has(ref.number) && !(ref.number in prs)) unresolved.add(ref.number);
		}
	}
	for (const refs of blocksByNumber.values()) {
		for (const ref of refs) {
			if (!known.has(ref.number) && !(ref.number in prs)) unresolved.add(ref.number);
		}
	}
	const unresolvedList = [...unresolved].sort((a, b) => a - b);
	if (unresolvedList.length) {
		options.progress?.(`Resolving ${unresolvedList.length} referenced issues…`);
		const externals: ResolvedExternals = await loader.resolveExternals(unresolvedList);
		for (const issue of externals.issues) {
			if (!known.has(issue.number)) {
				extraIssues.push(issue);
				known.set(issue.number, issue);
			}
		}
		for (const pr of externals.prs) prs[pr.number] = pr;
		if (externals.missing.length) {
			loader.warnings.push(
				'Referenced but not found (deleted, cross-repo, or rate-capped): ' +
					`${externals.missing
						.slice(0, 10)
						.map((n) => `#${n}`)
						.join(', ')}` +
					`${externals.missing.length > 10 ? ', …' : ''}`
			);
		}
	}

	// Final refs and edges between issues we have records for.
	const edges = new Map<string, DepEdge>();
	const addEdge = (from: number, to: number, source: DependencyRef['source']) => {
		if (from === to) return;
		const id = `${from}->${to}`;
		const existing = edges.get(id);
		if (!existing || EDGE_PRIORITY[source] > EDGE_PRIORITY[existing.source]) {
			edges.set(id, { from, to, source });
		}
	};
	const prTaskRefs: string[] = [];
	for (const issue of known.values()) {
		issue.blockedBy = blockedByByNumber.get(issue.number) ?? [];
		issue.blocks = blocksByNumber.get(issue.number) ?? [];
		for (const ref of issue.blockedBy) {
			if (known.has(ref.number)) {
				addEdge(ref.number, issue.number, ref.source);
			} else if (ref.number in prs) {
				prTaskRefs.push(`#${issue.number} → PR #${ref.number}`);
			}
		}
		for (const ref of issue.blocks) {
			if (known.has(ref.number)) {
				addEdge(issue.number, ref.number, ref.source);
			}
		}
	}
	if (prTaskRefs.length) {
		loader.warnings.push(
			`Task lists reference PRs (kept as references, not issue deps): ${prTaskRefs.slice(0, 8).join(', ')}` +
				`${prTaskRefs.length > 8 ? ', …' : ''}`
		);
	}
	// Fill the reverse direction ("blocks") from the final edges
	// so native relationships are reflected on the blocker too.
	for (const edge of edges.values()) {
		const blocker = known.get(edge.from);
		if (blocker) {
			blocker.blocks = dedupeRefs([...blocker.blocks, { number: edge.to, source: edge.source }]);
		}
	}

	const snap = loader.snapshot();
	const data: RepoData = {
		owner,
		repo,
		scope: options.scope,
		issues,
		referencedIssues: extraIssues,
		edges: [...edges.values()],
		prs,
		meta: {
			nameWithOwner: loader.nameWithOwner,
			scope: options.scope,
			source: options.token ? 'graphql' : 'rest',
			requestCount: snap.requestCount,
			rateLimit: snap.rate,
			totalIssues: loader.totalIssues,
			truncatedIssues: loader.truncated,
			prLinkDetection: loader.prLinkDetection,
			nativeRelationships: loader.nativeRelationships,
			warnings: loader.warnings,
			fetchDurationMs: Date.now() - started,
			fetchedAt: new Date().toISOString(),
			fromCache: false
		}
	};
	if (!writeRepoCache(key, data)) {
		data.meta.warnings.push('Data was not cached locally (payload too large for localStorage).');
	}
	return data;
}

/**
 * Classify a referenced number against the loaded data:
 * an issue we have a record for, a PR we know about, or missing.
 */
export function resolveRef(data: RepoData, number: number): RefResolution {
	const issue =
		data.issues.find((i) => i.number === number) ??
		data.referencedIssues.find((i) => i.number === number);
	if (issue) return { kind: 'issue', issue };
	const pr = data.prs[number];
	if (pr) return { kind: 'pr', pr };
	return { kind: 'missing' };
}
