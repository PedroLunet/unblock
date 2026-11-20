export interface RepoTarget {
	owner: string;
	repo: string;
}

const SEG = '[A-Za-z0-9_.-]+';
const URL_RE = new RegExp(
	`^(?:https?://)?(?:www\\.)?github\\.com/(${SEG})/(${SEG})(?:/[^\\s]*)?$`,
	'i'
);
const SHORT_RE = new RegExp(`^(${SEG})/(${SEG})/?$`, 'i');

/**
 * Accepts `owner/repo`, `github.com/owner/repo`, `https://github.com/owner/repo`
 * and URL forms with trailing subpaths (e.g. `/issues`), with an optional `.git`.
 * Returns null when the input matches neither shape.
 */
export function parseRepoInput(raw: string): RepoTarget | null {
	const input = raw.trim();
	if (!input) return null;
	const url = input.match(URL_RE);
	if (url) return { owner: url[1], repo: url[2].replace(/\.git$/i, '') };
	const short = input.match(SHORT_RE);
	if (short) return { owner: short[1], repo: short[2].replace(/\.git$/i, '') };
	return null;
}
