/**
 * Runnable verification for the pure parts of the GitHub data layer
 * (no network, no localStorage). Execute with: `bun src/lib/github/verify.ts`
 */

import { parseRepoInput } from './input';
import { dedupeRefs, parseDependencies } from './parse-deps';
import { closingRefsIn } from './rest';

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

// --- parseDependencies (owner/repo = sveltejs/svelte, self = #1) ---

const deps = (body: string | null) => parseDependencies(body, 1, 'sveltejs', 'svelte');

eq('prose blocked by', deps('This is blocked by #12.').blockedBy, [{ number: 12, source: 'text' }]);
eq('label style bold + colon', deps('**Blocked by:** #12, #13').blockedBy, [
	{ number: 12, source: 'text' },
	{ number: 13, source: 'text' }
]);
eq('blockers list', deps('Blockers: #5, #6 and #7').blockedBy, [
	{ number: 5, source: 'text' },
	{ number: 6, source: 'text' },
	{ number: 7, source: 'text' }
]);
eq('depends on', deps('Depends on #34.').blockedBy, [{ number: 34, source: 'text' }]);
eq('hyphenated depends-on', deps('Depends-on #34.').blockedBy, [{ number: 34, source: 'text' }]);
eq('depend on', deps('We depend on #9.').blockedBy, [{ number: 9, source: 'text' }]);
eq('requires', deps('Requires #56 to land first.').blockedBy, [{ number: 56, source: 'text' }]);
eq('reverse blocks', deps('This blocks #78 until the API is stable.').blocks, [
	{ number: 78, source: 'text' }
]);
eq('blocked by does not leak into reverse', deps('blocked by #12').blocks, []);
eq('task list item', deps('- [ ] #56\n- [x] #57\n  - [ ] #58').blockedBy, [
	{ number: 56, source: 'tasklist' },
	{ number: 57, source: 'tasklist' },
	{ number: 58, source: 'tasklist' }
]);
eq('task item prose keeps keyword refs', deps('- [ ] ship after we are blocked by #9').blockedBy, [
	{ number: 9, source: 'text' }
]);
eq(
	'task item with leading ref only takes that ref',
	deps('- [ ] #56 plus follow-up in #57').blockedBy,
	[{ number: 56, source: 'tasklist' }]
);
eq(
	'task item that is a same-repo issue url',
	deps('- [ ] https://github.com/sveltejs/svelte/issues/56').blockedBy,
	[{ number: 56, source: 'tasklist' }]
);
eq(
	'task item that is a cross-repo issue url ignored',
	deps('- [ ] https://github.com/sveltejs/kit/issues/56').blockedBy,
	[]
);
eq('task item cross-repo shorthand ignored', deps('- [ ] sveltejs/kit#56').blockedBy, []);
eq(
	'task item plain mention is not a dep',
	deps('- [ ] write docs, see #56 for context').blockedBy,
	[]
);
eq('fenced code block ignored', deps('Example:\n```js\nblocked by #12\n```').blockedBy, []);
eq('tilde fence ignored', deps('~~~\nblocked by #12\n~~~').blockedBy, []);
eq('inline code ignored', deps('blocked by `#12`').blockedBy, []);
eq('blockquote ignored', deps('> blocked by #12').blockedBy, []);
eq('html comment ignored', deps('<!-- blocked by #12 -->').blockedBy, []);
eq('case insensitive mid-sentence', deps('We are BLOCKED BY #12 today.').blockedBy, [
	{ number: 12, source: 'text' }
]);
eq(
	'comma list on one line',
	deps('blocked by #2, #3 and #4').blockedBy.map((r) => r.number),
	[2, 3, 4]
);
eq('self reference ignored', deps('blocked by #1').blockedBy, []);
eq('cross-repo shorthand ignored', deps('depends on sveltejs/kit#56.').blockedBy, []);
eq('same-repo shorthand accepted', deps('depends on sveltejs/svelte#100.').blockedBy, [
	{ number: 100, source: 'text' }
]);
eq(
	'same-repo issue url accepted',
	deps('depends on https://github.com/sveltejs/svelte/issues/99.').blockedBy,
	[{ number: 99, source: 'text' }]
);
eq(
	'cross-repo issue url ignored',
	deps('depends on https://github.com/sveltejs/kit/issues/99.').blockedBy,
	[]
);
eq('null body', deps(null), { blockedBy: [], blocks: [] });
eq(
	'dedup keeps highest-priority source',
	dedupeRefs([
		{ number: 5, source: 'tasklist' },
		{ number: 5, source: 'text' },
		{ number: 5, source: 'native' },
		{ number: 2, source: 'text' }
	]),
	[
		{ number: 2, source: 'text' },
		{ number: 5, source: 'native' }
	]
);
eq(
	'reactive dependencies prose is not a dep (real-world svelte #18966)',
	deps(
		"That run also records the derived's dependencies, so the derived ends up depending " +
			'on the old nested objects instead of the new ones. #16363 had the same cause. Its fix, ' +
			'#16438, skips the re-run only for a derived with no dependencies, which does not cover this case.'
	).blockedBy,
	[]
);
eq(
	'derived dependencies prose is not a dep (real-world svelte #19047)',
	deps(
		'Our expectation is based on Synchronized updates and derived dependencies. ' +
			'We understand async is experimental. Unlike #17099, this example does not create a new branch.'
	).blockedBy,
	[]
);
eq(
	'prose blocker with refs in the same paragraph is not a dep (real-world tts #935)',
	deps(
		"The only real consumer of this list is the planner's course picker, which shows {name} ({acronym}) per row. " +
			'Without the join, migrating it to this endpoint (#928) needs an N+1 of GET /v1/occurrences/:id?year= per row, ' +
			'or an extra GET /v1/courses/:id/units just to build an id → name map. That is the main blocker. #929 covers it.'
	).blockedBy,
	[]
);
eq(
	'reverse Blocks line still works',
	deps('- Blocks #928 (planner course-unit list migration).').blocks,
	[{ number: 928, source: 'text' }]
);
eq('dependencies as a label', deps('**Dependencies:** #12, #13').blockedBy, [
	{ number: 12, source: 'text' },
	{ number: 13, source: 'text' }
]);
eq('depends label shorthand', deps('Depends: #12').blockedBy, [{ number: 12, source: 'text' }]);
eq('blocker label singular', deps('- Blocker: #9').blockedBy, [{ number: 9, source: 'text' }]);
eq('plain dependencies header without refs on the line', deps('Dependencies').blockedBy, []);
eq(
	'mixed real-world body',
	deps(
		[
			'Title says it all.',
			'',
			'**Blocked by:** #12, #13',
			'',
			'Tasks:',
			'- [ ] #56',
			'- [x] docs done',
			'',
			'> originally reported as blocked by #99',
			'',
			'```',
			'blocked by #1000 (example, ignore me)',
			'```',
			'',
			'This blocks #78.'
		].join('\n')
	),
	{
		blockedBy: [
			{ number: 12, source: 'text' },
			{ number: 13, source: 'text' },
			{ number: 56, source: 'tasklist' }
		],
		blocks: [{ number: 78, source: 'text' }]
	}
);

// --- closingRefsIn (PR bodies) ---

eq('closes', closingRefsIn('Closes #12'), [12]);
eq('fixes with colon', closingRefsIn('Fixes: #7'), [7]);
eq('resolved plural', closingRefsIn('resolves #1, #2'), [1, 2]);
eq('fixed past tense', closingRefsIn('this PR fixed #4'), [4]);
eq('prefix does not match', closingRefsIn('the prefix #12'), []);
eq('plain mention is not closing', closingRefsIn('see #12 for context'), []);
eq('null body', closingRefsIn(null), []);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
	throw new Error(`${failures} verification checks failed`);
}
