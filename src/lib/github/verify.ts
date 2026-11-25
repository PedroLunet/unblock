/**
 * Runnable verification for the pure parts of the GitHub data layer
 * (no network, no localStorage). Execute with: `bun src/lib/github/verify.ts`
 *
 * Note: blocking relationships are native-only (GitHub issue Relationships),
 * so there is no body-text dependency parser to test anymore.
 */

import { parseRepoInput } from './input';
import { iterationKey, primaryIteration, iterationStatus, uniqueIterations } from './iterations';
import { closingRefsIn } from './rest';
import { buildSnapshot, diffRepo } from './snapshot';
import type { IssueRecord, IterationInfo, LinkedPR, RepoData } from './types';

let failures = 0;
let checks = 0;

function eq(name: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a !== e) {
		failures++;
		console.error(`✗ ${name}\n    expected ${e}\n    actual   ${a}`);
	} else {
		console.log(`✓ ${name}`);
	}
}

// --- parseRepoInput ---

eq('owner/repo', parseRepoInput('sveltejs/svelte'), { owner: 'sveltejs', repo: 'svelte' });
eq('full https url', parseRepoInput('https://github.com/sveltejs/svelte'), {
	owner: 'sveltejs',
	repo: 'svelte'
});
eq('url with subpath', parseRepoInput('https://github.com/sveltejs/svelte/issues'), {
	owner: 'sveltejs',
	repo: 'svelte'
});
eq('bare domain', parseRepoInput('github.com/sveltejs/svelte'), {
	owner: 'sveltejs',
	repo: 'svelte'
});
eq('.git suffix stripped', parseRepoInput('https://github.com/sveltejs/svelte.git'), {
	owner: 'sveltejs',
	repo: 'svelte'
});
eq('trailing slash', parseRepoInput('sveltejs/svelte/'), { owner: 'sveltejs', repo: 'svelte' });
eq('whitespace trimmed', parseRepoInput('  sveltejs/svelte '), {
	owner: 'sveltejs',
	repo: 'svelte'
});
eq('empty is null', parseRepoInput(''), null);
eq('single word is null', parseRepoInput('sveltejs'), null);
eq('non-github url is null', parseRepoInput('https://gitlab.com/a/b'), null);
eq('three segments is null', parseRepoInput('a/b/c'), null);

// --- closingRefsIn (PR bodies, for anonymous linked-PR detection) ---

eq('closes', closingRefsIn('Closes #12'), [12]);
eq('fixes with colon', closingRefsIn('Fixes: #7'), [7]);
eq('resolved plural', closingRefsIn('resolves #1, #2'), [1, 2]);
eq('fixed past tense', closingRefsIn('this PR fixed #4'), [4]);
eq('prefix does not match', closingRefsIn('the prefix #12'), []);
eq('plain mention is not closing', closingRefsIn('see #12 for context'), []);
eq('null body', closingRefsIn(null), []);

// --- buildSnapshot / diffRepo (refresh summary, no network) ---

const FIXED_AT = '2026-01-01T00:00:00Z';

function fixturePR(number: number, state: LinkedPR['state'], draft = false): LinkedPR {
	return {
		number,
		title: `PR ${number}`,
		url: `https://github.com/o/r/pull/${number}`,
		state,
		draft,
		author: 'alice',
		mergedAt: null,
		mergeStateUnknown: false,
		crossRepository: false
	};
}

function fixtureIteration(overrides: Partial<IterationInfo> = {}): IterationInfo {
	return {
		id: 'iteration-2',
		title: 'Iteration 2',
		startDate: '2026-01-05',
		duration: 14,
		projectNumber: 9,
		projectTitle: 'Roadmap',
		...overrides
	};
}

function fixtureIssue(number: number, overrides: Partial<IssueRecord> = {}): IssueRecord {
	return {
		id: `I_${number}`,
		number,
		title: `Issue ${number}`,
		state: 'open',
		url: `https://github.com/o/r/issues/${number}`,
		body: '',
		author: 'alice',
		createdAt: FIXED_AT,
		updatedAt: FIXED_AT,
		closedAt: null,
		assignees: [],
		labels: [],
		milestone: null,
		iterations: [],
		comments: 0,
		reactions: null,
		blockedBy: [],
		blocks: [],
		linkedPRs: [],
		inScope: true,
		prScan: 'full',
		...overrides
	};
}

function fixtureRepo(overrides: Partial<RepoData> = {}): RepoData {
	return {
		owner: 'o',
		repo: 'r',
		scope: 'open',
		issues: [],
		referencedIssues: [],
		edges: [],
		prs: {},
		meta: {
			nameWithOwner: 'o/r',
			scope: 'open',
			source: 'rest',
			requestCount: 1,
			rateLimit: null,
			totalIssues: null,
			truncatedIssues: false,
			prLinkDetection: '',
			nativeRelationships: 'used',
			projectIterations: 'no-access',
			warnings: [],
			fetchDurationMs: 1,
			fetchedAt: FIXED_AT,
			fromCache: false
		},
		...overrides
	};
}

const before = fixtureRepo({
	issues: [
		fixtureIssue(1, { title: 'Old title' }),
		fixtureIssue(2, {
			blockedBy: [{ number: 1, source: 'native' }],
			linkedPRs: [fixturePR(10, 'open', true)]
		}),
		fixtureIssue(3, { state: 'closed', closedAt: FIXED_AT })
	],
	edges: [{ from: 1, to: 2, source: 'native' }],
	prs: { 10: fixturePR(10, 'open', true) }
});
const after = fixtureRepo({
	issues: [
		fixtureIssue(1, { title: 'New title' }),
		fixtureIssue(2, {
			state: 'closed',
			closedAt: FIXED_AT,
			blockedBy: [{ number: 1, source: 'native' }],
			linkedPRs: [fixturePR(10, 'open', false)]
		}),
		fixtureIssue(3),
		fixtureIssue(4)
	],
	edges: [{ from: 1, to: 4, source: 'native' }],
	prs: { 10: fixturePR(10, 'open', false) },
	meta: {
		...fixtureRepo().meta,
		fetchedAt: '2026-01-02T00:00:00Z'
	}
});
const diff = diffRepo(buildSnapshot(before), after);

eq(
	'snapshot diff adds issues',
	diff.addedIssues.map((issue) => issue.number),
	[4]
);
eq(
	'snapshot diff closes issues',
	diff.closedIssues.map((issue) => issue.number),
	[2]
);
eq(
	'snapshot diff reopens issues',
	diff.reopenedIssues.map((issue) => issue.number),
	[3]
);
eq(
	'snapshot diff updates titles',
	diff.updatedIssues.filter((issue) => issue.fields.includes('title')).map((issue) => issue.number),
	[1]
);
eq('snapshot diff adds edges', diff.addedEdges, [{ from: 1, to: 4 }]);
eq('snapshot diff removes edges', diff.removedEdges, [{ from: 1, to: 2 }]);
eq('snapshot diff detects draft -> open', diff.changedPRs, [
	{ number: 10, title: 'PR 10', from: 'draft', to: 'open' }
]);
eq('snapshot diff unchanged data', diffRepo(buildSnapshot(after), after).hasChanges, false);

// --- project iterations ---

const iterationA = fixtureIteration();
const iterationAOtherProject = fixtureIteration({ projectNumber: 12, projectTitle: 'Platform' });
const iterationB = fixtureIteration({
	id: 'iteration-3',
	title: 'Iteration 3',
	startDate: '2026-01-19'
});
const beforeStart = Date.parse('2026-01-04T12:00:00Z');
const duringIteration = Date.parse('2026-01-10T12:00:00Z');
const afterIteration = Date.parse('2026-01-19T00:00:00Z');

eq(
	'iteration key merges the same sprint across projects',
	iterationKey(iterationA),
	iterationKey(iterationAOtherProject)
);
eq(
	'unique iterations merges the same sprint across projects',
	uniqueIterations([iterationA, iterationAOtherProject]).length,
	1
);
eq(
	'iteration key distinguishes start dates',
	iterationKey(iterationA) !== iterationKey(iterationB),
	true
);
eq('iteration status before start', iterationStatus(iterationA, beforeStart), 'upcoming');
eq('iteration status during', iterationStatus(iterationA, duringIteration), 'active');
eq('iteration status after end (exclusive)', iterationStatus(iterationA, afterIteration), 'past');
eq(
	'primary iteration prefers the active sprint',
	primaryIteration([iterationB, iterationA], duringIteration)?.title,
	'Iteration 2'
);
eq(
	'primary iteration prefers the next upcoming sprint',
	primaryIteration([iterationB, iterationA], beforeStart)?.title,
	'Iteration 2'
);
eq(
	'primary iteration falls back to the latest past sprint',
	primaryIteration([iterationA, iterationB], afterIteration + 40 * 86400000)?.title,
	'Iteration 3'
);

const withoutIteration = fixtureRepo({ issues: [fixtureIssue(1)] });
const withIteration = fixtureRepo({
	issues: [fixtureIssue(1, { iterations: [iterationA] })]
});
eq(
	'snapshot diff detects iteration changes',
	diffRepo(buildSnapshot(withoutIteration), withIteration).updatedIssues[0]?.fields,
	['iteration']
);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
	throw new Error(`${failures} verification checks failed`);
}
