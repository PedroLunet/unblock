import { resolve } from '$app/paths';
import { GithubError } from './errors';
import type { GitHubUser, IssueState, LabelInfo, MilestoneInfo } from './types';

const GITHUB_GRAPHQL_PROXY = resolve('/api/github/graphql');

interface GqlErrorLike {
	message: string;
}

interface GqlResponse<T> {
	data?: T | null;
	errors?: GqlErrorLike[];
}

// GitHub's GraphQL backend intermittently fails valid queries with an internal
// error that carries a request ID meant for GitHub support. It usually succeeds
// on a second attempt, so reads and idempotent edit mutations get one quiet retry.
const INTERNAL_ERROR = /Something went wrong while executing your query/i;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 300;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gqlOnce<T>(query: string, variables: Record<string, unknown>): Promise<T> {
	let res: Response;
	try {
		res = await fetch(GITHUB_GRAPHQL_PROXY, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
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
		if (res.status >= 500) {
			throw new GithubError(
				'unavailable',
				'GitHub is having trouble right now. Try again in a moment.',
				res.status
			);
		}
		throw new GithubError(
			'unknown',
			`GitHub GraphQL error ${res.status} ${res.statusText}`,
			res.status
		);
	}
	const json: GqlResponse<T> = await res.json();
	if (json.errors?.length) {
		const message = json.errors[0].message;
		if (INTERNAL_ERROR.test(message)) {
			// Keep the request ID in the console; it means nothing to someone
			// trying to assign an issue.
			console.warn(`GitHub GraphQL internal error: ${message}`);
			throw new GithubError(
				'unavailable',
				'GitHub could not complete that request. This is usually temporary, so try again.',
				502
			);
		}
		const sentence = message.endsWith('.') ? message : `${message}.`;
		const permissionHint = /not accessible|permission|scope|forbidden/i.test(message)
			? ' You may not have permission to edit this issue, or your sign-in may be missing write access.'
			: '';
		throw new GithubError('unknown', `GitHub: ${sentence}${permissionHint}`);
	}
	if (json.data === undefined || json.data === null) {
		throw new GithubError('unknown', 'GitHub GraphQL returned no data.');
	}
	return json.data;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await gqlOnce<T>(query, variables);
		} catch (err) {
			const transient = err instanceof GithubError && err.kind === 'unavailable';
			if (!transient || attempt >= MAX_ATTEMPTS) throw err;
			await delay(RETRY_DELAY_MS);
		}
	}
}

// --- GraphQL payload shapes (only what we read) ---

interface GqlUserNode {
	id: string;
	login: string;
	name: string | null;
	avatarUrl: string;
}

interface GqlLabelNode {
	id: string;
	name: string;
	color: string;
}

interface GqlMilestoneNode {
	id: string;
	number: number;
	title: string;
	state: 'OPEN' | 'CLOSED';
	dueOn: string | null;
	progressPercentage: number;
}

interface EditOptionsData {
	repository: {
		assignableUsers: { nodes: GqlUserNode[] | null } | null;
		labels: { nodes: GqlLabelNode[] | null } | null;
		milestones: { nodes: GqlMilestoneNode[] | null } | null;
	} | null;
}

interface AssignableUsersData {
	repository: {
		assignableUsers: { nodes: GqlUserNode[] | null } | null;
	} | null;
}

const EDIT_OPTIONS_QUERY = `
	query EditOptions($owner: String!, $repo: String!, $query: String) {
		repository(owner: $owner, name: $repo) {
			assignableUsers(first: 100, query: $query) {
				nodes { id login name avatarUrl }
			}
			labels(first: 100, orderBy: { field: NAME, direction: ASC }) {
				nodes { id name color }
			}
			milestones(first: 100, states: [OPEN], orderBy: { field: DUE_DATE, direction: ASC }) {
				nodes { id number title state dueOn progressPercentage }
			}
		}
	}
`;

const ASSIGNABLE_USERS_QUERY = `
	query AssignableUsers($owner: String!, $repo: String!, $query: String) {
		repository(owner: $owner, name: $repo) {
			assignableUsers(first: 100, query: $query) {
				nodes { id login name avatarUrl }
			}
		}
	}
`;

export interface AssignableUser {
	id: string;
	login: string;
	name: string | null;
	avatarUrl: string;
}

export interface EditOptions {
	assignees: AssignableUser[];
	labels: LabelInfo[];
	milestones: MilestoneInfo[];
}

function mapAssignableUser(node: GqlUserNode): AssignableUser {
	return {
		id: node.id,
		login: node.login,
		name: node.name,
		avatarUrl: node.avatarUrl
	};
}

function mapLabel(node: GqlLabelNode): LabelInfo {
	return { id: node.id, name: node.name, color: node.color };
}

function mapMilestone(node: GqlMilestoneNode): MilestoneInfo {
	return {
		id: node.id,
		number: node.number,
		title: node.title,
		state: node.state === 'OPEN' ? 'open' : 'closed',
		dueOn: node.dueOn,
		progressPercentage: node.progressPercentage
	};
}

function repositoryMissing(owner: string, repo: string): GithubError {
	return new GithubError(
		'not-found',
		`Repository ${owner}/${repo} not found, or your GitHub account cannot see it.`,
		404
	);
}

/** People who can be assigned, repository labels and open milestones. */
export async function loadEditOptions(owner: string, repo: string): Promise<EditOptions> {
	const data = await gql<EditOptionsData>(EDIT_OPTIONS_QUERY, { owner, repo, query: null });
	if (!data.repository) throw repositoryMissing(owner, repo);
	return {
		assignees: (data.repository.assignableUsers?.nodes ?? []).map(mapAssignableUser),
		labels: (data.repository.labels?.nodes ?? []).map(mapLabel),
		milestones: (data.repository.milestones?.nodes ?? []).map(mapMilestone)
	};
}

/** Search assignable people by login or name (GitHub caps the list at 100). */
export async function searchAssignableUsers(
	owner: string,
	repo: string,
	query: string
): Promise<AssignableUser[]> {
	const data = await gql<AssignableUsersData>(ASSIGNABLE_USERS_QUERY, {
		owner,
		repo,
		query: query || null
	});
	if (!data.repository) throw repositoryMissing(owner, repo);
	return (data.repository.assignableUsers?.nodes ?? []).map(mapAssignableUser);
}

// --- update mutation ---

interface GqlUpdatedIssue {
	id: string;
	number: number;
	title?: string;
	body?: string | null;
	state?: 'OPEN' | 'CLOSED';
	updatedAt: string;
	closedAt?: string | null;
	assignees?: { nodes: { id: string; login: string; url: string; avatarUrl: string }[] } | null;
	labels?: { nodes: { id: string; name: string; color: string }[] } | null;
	milestone?: GqlMilestoneNode | null;
}

interface UpdateIssueData {
	updateIssue: { issue: GqlUpdatedIssue | null } | null;
}

export interface IssueChanges {
	title?: string;
	body?: string;
	state?: IssueState;
	/** Complete replacement list of GraphQL user node IDs. */
	assigneeIds?: string[];
	/** Complete replacement list of GraphQL label node IDs. */
	labelIds?: string[];
	/** GraphQL milestone node ID; null clears the milestone. */
	milestoneId?: string | null;
}

/**
 * The fields the mutation changed; the caller merges only these into its full
 * issue record. Untouched fields are absent (not `undefined` values) so two
 * overlapping saves cannot overwrite each other with stale data.
 */
export interface IssueUpdate {
	id: string;
	number: number;
	updatedAt: string;
	title?: string;
	body?: string;
	state?: IssueState;
	closedAt?: string | null;
	assignees?: GitHubUser[];
	labels?: LabelInfo[];
	milestone?: MilestoneInfo | null;
}

/** Build a selection for exactly the fields being changed. */
function updateSelection(changes: IssueChanges): string {
	const fields = ['id', 'number', 'updatedAt'];
	if (changes.title !== undefined) fields.push('title');
	if (changes.body !== undefined) fields.push('body');
	if (changes.state !== undefined) fields.push('state', 'closedAt');
	if (changes.assigneeIds !== undefined) {
		fields.push('assignees(first: 10) { nodes { id login url avatarUrl } }');
	}
	if (changes.labelIds !== undefined) {
		fields.push('labels(first: 100) { nodes { id name color } }');
	}
	if (changes.milestoneId !== undefined) {
		fields.push('milestone { id number title state dueOn progressPercentage }');
	}
	return fields.join(' ');
}

/** Apply a partial edit with a single GraphQL mutation. */
export async function updateIssue(issueId: string, changes: IssueChanges): Promise<IssueUpdate> {
	if (!issueId) {
		throw new GithubError(
			'unknown',
			'This issue has no GitHub node ID yet. Refresh the board, then try again.'
		);
	}
	const input: Record<string, unknown> = { id: issueId };
	if (changes.title !== undefined) input.title = changes.title;
	if (changes.body !== undefined) input.body = changes.body;
	if (changes.state !== undefined) input.state = changes.state === 'open' ? 'OPEN' : 'CLOSED';
	if (changes.assigneeIds !== undefined) input.assigneeIds = changes.assigneeIds;
	if (changes.labelIds !== undefined) input.labelIds = changes.labelIds;
	if (changes.milestoneId !== undefined) input.milestoneId = changes.milestoneId;
	if (Object.keys(input).length === 1) {
		throw new GithubError('unknown', 'There are no changes to save.');
	}

	const query = `mutation UpdateIssue($input: UpdateIssueInput!) {
		updateIssue(input: $input) {
			issue { ${updateSelection(changes)} }
		}
	}`;
	const data = await gql<UpdateIssueData>(query, { input });
	const issue = data.updateIssue?.issue;
	if (!issue) {
		throw new GithubError('unknown', 'GitHub did not return the updated issue.');
	}

	const update: IssueUpdate = {
		id: issue.id,
		number: issue.number,
		updatedAt: issue.updatedAt
	};
	if (issue.title !== undefined) update.title = issue.title;
	if (issue.body !== undefined) update.body = issue.body ?? '';
	if (issue.state !== undefined) update.state = issue.state === 'OPEN' ? 'open' : 'closed';
	if (issue.closedAt !== undefined) update.closedAt = issue.closedAt;
	if (issue.assignees !== undefined) {
		update.assignees = (issue.assignees?.nodes ?? []).map((u) => ({
			id: u.id,
			login: u.login,
			url: u.url,
			avatarUrl: u.avatarUrl
		}));
	}
	if (issue.labels !== undefined) {
		update.labels = (issue.labels?.nodes ?? []).map((l) => ({
			id: l.id,
			name: l.name,
			color: l.color
		}));
	}
	if (issue.milestone !== undefined) {
		update.milestone = issue.milestone ? mapMilestone(issue.milestone) : null;
	}
	return update;
}
