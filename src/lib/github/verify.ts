/**
 * Runnable verification for the pure parts of the GitHub data layer
 * (no network, no localStorage). Execute with: `bun src/lib/github/verify.ts`
 *
 * Note: blocking relationships are native-only (GitHub issue Relationships),
 * so there is no body-text dependency parser to test anymore.
 */

import { parseRepoInput } from './input';
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

// --- closingRefsIn (PR bodies, for anonymous linked-PR detection) ---

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
