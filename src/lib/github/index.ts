import { loadRepoViaGraphQL } from './graphql';
import { loadRepoViaRest } from './rest';
import { readRepoCache, repoCacheKey, writeRepoCache } from './storage';
import type {
	AuthMode,
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
export { buildSnapshot, diffRepo } from './snapshot';
export {
	iterationKey,
	iterationRangeLabel,
	iterationStatus,
	iterationStatusLabel,
	primaryIteration,
	uniqueIterations
} from './iterations';
export type { IterationStatus } from './iterations';
export { loadEditOptions, searchAssignableUsers, updateIssue } from './edit';
export type { AssignableUser, EditOptions, IssueChanges, IssueUpdate } from './edit';
export type {
	DiffEdge,
	DiffIssue,
	DiffIssueUpdate,
	DiffPullRequest,
	IssueUpdateField,
	RepoDiff,
	RepoSnapshot,
	SnapshotEdge,
	SnapshotIssue,
	SnapshotPullRequest
} from './snapshot';
export {
	clearLegacyPat,
	clearOtherRepoEntries,
	readSnapshot,
	repoCacheKey,
	writeRepoCache,
	writeSnapshot
} from './storage';

export interface LoadRepoOptions {
	/** Signed-in requests use GraphQL via the server proxy; anonymous uses REST. */
	auth: AuthMode;
	scope: FetchScope;
	/** Skip the 1-hour cache and force a refetch. */
	refresh?: boolean;
	/** Read GitHub Projects (v2) iterations (requires `read:project`). */
	includeProjectIterations?: boolean;
	progress?: (message: string) => void;
}

/** Dedupe refs by issue number. */
function dedupeRefs(refs: DependencyRef[]): DependencyRef[] {
	const map = new Map<number, DependencyRef>();
	for (const ref of refs) {
		if (!map.has(ref.number)) map.set(ref.number, ref);
	}
	return [...map.values()].sort((a, b) => a.number - b.number);
}

const EDGE_PRIORITY: Record<DependencyRef['source'], number> = {
	native: 3,
	text: 2,
	tasklist: 1
};

/**
 * Load a repository's issues, dependency edges and linked PRs.
 * Signed-in users get GraphQL via the server proxy; anonymous uses capped REST.
 * Results are cached in localStorage for an hour (bypass with `refresh`).
 */
export async function loadRepo(
	owner: string,
	repo: string,
	options: LoadRepoOptions
): Promise<RepoData> {
	const key = repoCacheKey(
		owner,
		repo,
		options.scope,
		options.auth,
		options.includeProjectIterations
	);
	if (!options.refresh) {
		const cached = readRepoCache(key);
		if (cached) return cached;
	}

	const started = Date.now();
	const loaderOptions = {
		scope: options.scope,
		includeProjectIterations: options.includeProjectIterations === true,
		progress: options.progress
	};
	const loader =
		options.auth === 'github'
			? await loadRepoViaGraphQL(owner, repo, loaderOptions)
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

	// Blocking relationships come exclusively from GitHub's native issue
	// relationships (the "Relationships" attribute on the issue). Body text and
	// task lists are intentionally NOT parsed: prose gets stale and produced
	// false, reversed edges on real repositories (niaefeup/tts, sveltejs/svelte).
	const blockedByByNumber = new Map<number, DependencyRef[]>();
	for (const issue of known.values()) {
		const native = (loader.nativeBlockedBy.get(issue.number) ?? []).map((n) => ({
			number: n,
			source: 'native' as const
		}));
		blockedByByNumber.set(issue.number, dedupeRefs(native));
	}

	// Native blockers may be outside the current scope (e.g. closed issues
	// while in open-only mode): resolve them so their state is known.
	const unresolved = new Set<number>();
	for (const refs of blockedByByNumber.values()) {
		for (const ref of refs) {
			if (!known.has(ref.number)) unresolved.add(ref.number);
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
	for (const issue of known.values()) {
		issue.blockedBy = blockedByByNumber.get(issue.number) ?? [];
		issue.blocks = [];
		for (const ref of issue.blockedBy) {
			if (known.has(ref.number)) {
				addEdge(ref.number, issue.number, ref.source);
			}
		}
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
			source: options.auth === 'github' ? 'graphql' : 'rest',
			requestCount: snap.requestCount,
			rateLimit: snap.rate,
			totalIssues: loader.totalIssues,
			truncatedIssues: loader.truncated,
			prLinkDetection: loader.prLinkDetection,
			nativeRelationships: loader.nativeRelationships,
			projectIterations: loader.projectIterations,
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
