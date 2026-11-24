import type {
	FetchScope,
	IssueRecord,
	IssueState,
	LinkedPR,
	LinkedPRState,
	RepoData
} from './types';

export const SNAPSHOT_VERSION = 1;

/** What the card chip shows for a linked PR. */
export type PRDisplayState = LinkedPRState | 'draft';

/**
 * A compact, body-free copy of one board fetch. It is persisted in localStorage
 * so a refresh can explain what changed without keeping another full payload.
 */
export interface SnapshotIssue {
	number: number;
	title: string;
	state: IssueState;
	inScope: boolean;
	updatedAt: string;
	assignees: string[];
	labels: string[];
	milestone: string | null;
	/** `number:state`, sorted. */
	linkedPRs: string[];
	comments: number;
	reactions: number | null;
}

export interface SnapshotEdge {
	from: number;
	to: number;
}

export interface SnapshotPullRequest {
	number: number;
	title: string;
	state: PRDisplayState;
}

export interface RepoSnapshot {
	version: typeof SNAPSHOT_VERSION;
	fetchedAt: string;
	source: RepoData['meta']['source'];
	scope: FetchScope;
	issues: SnapshotIssue[];
	edges: SnapshotEdge[];
	prs: SnapshotPullRequest[];
}

export interface DiffIssue {
	number: number;
	title: string;
	state: IssueState;
}

export interface DiffEdge {
	from: number;
	to: number;
}

export interface DiffPullRequest {
	number: number;
	title: string;
	from: PRDisplayState | null;
	to: PRDisplayState | null;
}

export type IssueUpdateField =
	| 'title'
	| 'assignees'
	| 'labels'
	| 'milestone'
	| 'linkedPRs'
	| 'comments'
	| 'reactions'
	| 'details';

export interface DiffIssueUpdate {
	number: number;
	title: string;
	fields: IssueUpdateField[];
}

export interface RepoDiff {
	scope: FetchScope;
	previousFetchedAt: string;
	fetchedAt: string;
	addedIssues: DiffIssue[];
	removedIssues: DiffIssue[];
	closedIssues: DiffIssue[];
	reopenedIssues: DiffIssue[];
	updatedIssues: DiffIssueUpdate[];
	addedEdges: DiffEdge[];
	removedEdges: DiffEdge[];
	newPRs: DiffPullRequest[];
	changedPRs: DiffPullRequest[];
	removedPRs: DiffPullRequest[];
	totalChanges: number;
	hasChanges: boolean;
}

function sorted(values: Iterable<string>): string[] {
	return [...values].sort();
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** In-scope issues win over their referenced-issue copy. */
function issueRecords(data: RepoData): Map<number, IssueRecord> {
	const records = new Map<number, IssueRecord>();
	for (const issue of data.issues) records.set(issue.number, issue);
	for (const issue of data.referencedIssues) {
		if (!records.has(issue.number)) records.set(issue.number, issue);
	}
	return records;
}

/**
 * Only PRs attached to known issues are board-relevant. Anonymous REST also
 * returns unlinked open PRs, which must not pollute the refresh summary.
 */
function linkedPRsFor(data: RepoData): Map<number, LinkedPR> {
	const prs = new Map<number, LinkedPR>();
	for (const issue of issueRecords(data).values()) {
		for (const pr of issue.linkedPRs) prs.set(pr.number, pr);
	}
	return prs;
}

/** Draft open PRs read as "draft" on the card, not just "open". */
function displayPRState(pr: Pick<LinkedPR, 'state' | 'draft'>): PRDisplayState {
	return pr.draft === true ? 'draft' : pr.state;
}

function issueEdgeKey(from: number, to: number): string {
	return `${from}->${to}`;
}

function edgeFromKey(key: string): DiffEdge {
	const [from, to] = key.split('->').map(Number);
	return { from, to };
}

function toDiffIssue(issue: IssueRecord): DiffIssue {
	return { number: issue.number, title: issue.title, state: issue.state };
}

function changedFields(before: SnapshotIssue, after: IssueRecord): IssueUpdateField[] {
	const fields: IssueUpdateField[] = [];

	if (before.title !== after.title) fields.push('title');
	if (!sameStrings(before.assignees, sorted(after.assignees.map((user) => user.login)))) {
		fields.push('assignees');
	}
	if (
		!sameStrings(before.labels, sorted(after.labels.map((label) => `${label.name}:${label.color}`)))
	) {
		fields.push('labels');
	}
	if (before.milestone !== (after.milestone?.title ?? null)) fields.push('milestone');
	if (
		!sameStrings(before.linkedPRs, sorted(after.linkedPRs.map((pr) => `${pr.number}:${pr.state}`)))
	) {
		fields.push('linkedPRs');
	}
	if (before.comments !== after.comments) fields.push('comments');
	if (before.reactions !== (after.reactions?.total ?? null)) fields.push('reactions');
	// Any remaining edit (for example a body change) still bumps updatedAt.
	if (fields.length === 0 && before.updatedAt !== after.updatedAt) fields.push('details');

	return fields;
}

/** Capture the data currently shown on the board. */
export function buildSnapshot(data: RepoData): RepoSnapshot {
	const scoped = new Set(data.issues.map((issue) => issue.number));

	return {
		version: SNAPSHOT_VERSION,
		fetchedAt: data.meta.fetchedAt,
		source: data.meta.source,
		scope: data.scope,
		issues: [...issueRecords(data).values()]
			.sort((a, b) => a.number - b.number)
			.map((issue): SnapshotIssue => ({
				number: issue.number,
				title: issue.title,
				state: issue.state,
				inScope: scoped.has(issue.number),
				updatedAt: issue.updatedAt,
				assignees: sorted(issue.assignees.map((user) => user.login)),
				labels: sorted(issue.labels.map((label) => `${label.name}:${label.color}`)),
				milestone: issue.milestone?.title ?? null,
				linkedPRs: sorted(issue.linkedPRs.map((pr) => `${pr.number}:${pr.state}`)),
				comments: issue.comments,
				reactions: issue.reactions?.total ?? null
			})),
		edges: data.edges
			.map((edge) => ({ from: edge.from, to: edge.to }))
			.sort((a, b) => a.from - b.from || a.to - b.to),
		prs: [...linkedPRsFor(data).values()]
			.map((pr) => ({ number: pr.number, title: pr.title, state: displayPRState(pr) }))
			.sort((a, b) => a.number - b.number)
	};
}

/** Compare the previous board snapshot with a fresh fetch. */
export function diffRepo(previous: RepoSnapshot, next: RepoData): RepoDiff {
	const previousIssues = new Map(previous.issues.map((issue) => [issue.number, issue]));
	const previousScoped = new Set(
		previous.issues.filter((issue) => issue.inScope).map((issue) => issue.number)
	);
	const nextIssues = issueRecords(next);
	const nextScoped = new Set(next.issues.map((issue) => issue.number));

	const addedIssues: DiffIssue[] = [];
	const removedIssues: DiffIssue[] = [];
	const closedIssues: DiffIssue[] = [];
	const reopenedIssues: DiffIssue[] = [];
	const updatedIssues: DiffIssueUpdate[] = [];

	for (const issue of nextIssues.values()) {
		const before = previousIssues.get(issue.number);
		if (!before) {
			if (nextScoped.has(issue.number)) addedIssues.push(toDiffIssue(issue));
			continue;
		}
		if (before.state !== issue.state) {
			if (issue.state === 'closed') closedIssues.push(toDiffIssue(issue));
			else reopenedIssues.push(toDiffIssue(issue));
			continue;
		}
		const fields = changedFields(before, issue);
		// Referenced-only issues affect resolved-blocker state, but their own
		// metadata is not drawn on the board. Only report visible detail changes.
		if (fields.length > 0 && (before.inScope || nextScoped.has(issue.number))) {
			updatedIssues.push({ number: issue.number, title: issue.title, fields });
		}
	}

	for (const before of previous.issues) {
		if (before.inScope && !nextIssues.has(before.number)) {
			removedIssues.push({
				number: before.number,
				title: before.title,
				state: before.state
			});
		}
	}

	const previousEdges = new Set(previous.edges.map((edge) => issueEdgeKey(edge.from, edge.to)));
	const nextEdges = new Set(next.edges.map((edge) => issueEdgeKey(edge.from, edge.to)));
	// Edges between two referenced-only issues never reach the canvas; skip
	// them so the summary only describes visible changes.
	const addedEdges = [...nextEdges]
		.filter((key) => !previousEdges.has(key))
		.map(edgeFromKey)
		.filter((edge) => nextScoped.has(edge.from) || nextScoped.has(edge.to));
	const removedEdges = [...previousEdges]
		.filter((key) => !nextEdges.has(key))
		.map(edgeFromKey)
		.filter((edge) => previousScoped.has(edge.from) || previousScoped.has(edge.to));

	const previousPRs = new Map(previous.prs.map((pr) => [pr.number, pr]));
	const nextPRs = linkedPRsFor(next);
	const newPRs: DiffPullRequest[] = [];
	const changedPRs: DiffPullRequest[] = [];
	const removedPRs: DiffPullRequest[] = [];

	for (const [number, pr] of nextPRs) {
		const before = previousPRs.get(number);
		const state = displayPRState(pr);
		if (!before) {
			newPRs.push({ number, title: pr.title, from: null, to: state });
		} else if (before.state !== state) {
			changedPRs.push({ number, title: pr.title, from: before.state, to: state });
		}
	}
	for (const [number, pr] of previousPRs) {
		if (!nextPRs.has(number)) {
			removedPRs.push({ number, title: pr.title, from: pr.state, to: null });
		}
	}

	addedIssues.sort((a, b) => a.number - b.number);
	removedIssues.sort((a, b) => a.number - b.number);
	closedIssues.sort((a, b) => a.number - b.number);
	reopenedIssues.sort((a, b) => a.number - b.number);
	updatedIssues.sort((a, b) => a.number - b.number);
	addedEdges.sort((a, b) => a.from - b.from || a.to - b.to);
	removedEdges.sort((a, b) => a.from - b.from || a.to - b.to);
	newPRs.sort((a, b) => a.number - b.number);
	changedPRs.sort((a, b) => a.number - b.number);
	removedPRs.sort((a, b) => a.number - b.number);

	const totalChanges =
		addedIssues.length +
		removedIssues.length +
		closedIssues.length +
		reopenedIssues.length +
		updatedIssues.length +
		addedEdges.length +
		removedEdges.length +
		newPRs.length +
		changedPRs.length +
		removedPRs.length;

	return {
		scope: next.scope,
		previousFetchedAt: previous.fetchedAt,
		fetchedAt: next.meta.fetchedAt,
		addedIssues,
		removedIssues,
		closedIssues,
		reopenedIssues,
		updatedIssues,
		addedEdges,
		removedEdges,
		newPRs,
		changedPRs,
		removedPRs,
		totalChanges,
		hasChanges: totalChanges > 0
	};
}
