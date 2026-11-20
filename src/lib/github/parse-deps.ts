import type { DependencyRef } from './types';

export interface ParsedDeps {
	/** This issue is blocked by these numbers. */
	blockedBy: DependencyRef[];
	/** This issue blocks these numbers. */
	blocks: DependencyRef[];
}

/**
 * Mid-sentence dependency keywords. Note: the bare noun "dependencies" is
 * deliberately absent — it is common technical prose ("the derived's
 * dependencies, so ... #16363 had the same cause") and would create false
 * edges. It is matched only as a line label below.
 * Reverse direction ("blocks #n") is handled separately.
 */
const KEYWORDS = /\b(blocked[\s-]*by|blockers?|depends?[\s-]*on|requires|blocks)\b/gi;

/** Label-style lines: "**Dependencies:** #12, #13", "Depends: #12", "Blocker: #12". */
const DEPS_LABEL =
	/^\s*(?:[-*]\s+)?\*{0,2}\s*(blocked[\s-]*by|blockers?|depends?|dependencies|requires)\s*\*{0,2}\s*:\s*(.+)$/i;

const TASK_ITEM = /^\s*[-*]\s+\[[ xX]\]\s*(.*)$/;

/** `#123` with an optional `owner/repo` prefix (which must match the target repo). */
const NUM_REF = /(?:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+))?#(\d{1,7})\b/g;

/** Full same-repo issue URLs used inside task lists or prose. */
const ISSUE_URL = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d{1,7})\b/g;

/** A task item whose content *is* an issue reference (GitHub's canonical task-list form). */
const TASK_REF_ITEM =
	/^\s*(?:(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#\d{1,7}\b|https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/\d{1,7}\b)/;

/** The leading reference of such an item: `#12`, `owner/repo#12`, or a full issue URL. */
const LEADING_REF =
	/^\s*(?:(?:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+))?#(\d{1,7})\b|https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d{1,7})\b)/;

const SOURCE_PRIORITY: Record<DependencyRef['source'], number> = {
	native: 3,
	text: 2,
	tasklist: 1
};

/**
 * Strip regions we should never parse: fenced code blocks, blockquotes
 * (usually quoting someone else's text), HTML comments and inline code.
 */
function stripNonProse(body: string): string {
	const withoutComments = body.replace(/<!--[\s\S]*?-->/g, ' ');
	const lines = withoutComments.replace(/\r\n/g, '\n').split('\n');
	let inFence = false;
	const out: string[] = [];
	for (const line of lines) {
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		if (/^\s*>/.test(line)) continue;
		out.push(line);
	}
	return out.join('\n').replace(/`[^`\n]*`/g, ' ');
}

function extractNumbers(text: string, self: number, owner: string, repo: string): number[] {
	const found: number[] = [];
	const expected = `${owner}/${repo}`.toLowerCase();
	let m: RegExpExecArray | null;
	NUM_REF.lastIndex = 0;
	while ((m = NUM_REF.exec(text))) {
		if (m[1]) {
			const prefix = `${m[1]}/${m[2]}`.toLowerCase();
			if (prefix !== expected) continue; // cross-repo reference: ignored
		}
		found.push(parseInt(m[3], 10));
	}
	ISSUE_URL.lastIndex = 0;
	while ((m = ISSUE_URL.exec(text))) {
		const prefix = `${m[1]}/${m[2]}`.toLowerCase();
		if (prefix !== expected) continue;
		found.push(parseInt(m[3], 10));
	}
	return found.filter((n) => n > 0 && n !== self);
}

function classify(keyword: string): 'blockedBy' | 'blocks' {
	// "blocks" is the only reverse-direction keyword.
	return keyword.toLowerCase().replace(/[\s-]+/g, '') === 'blocks' ? 'blocks' : 'blockedBy';
}

/**
 * Parse blocking/dependency relationships from an issue body.
 * Recognized forms (case-insensitive):
 *   "blocked by #12", "blocker/blockers: #12", "depends on #34",
 *   "requires #56", "blocks #78" (reverse), task-list items "- [ ] #90".
 * Code blocks, inline code, blockquotes and cross-repo refs are ignored.
 */
export function parseDependencies(
	body: string | null,
	self: number,
	owner: string,
	repo: string
): ParsedDeps {
	const blockedBy: DependencyRef[] = [];
	const blocks: DependencyRef[] = [];
	const prose = stripNonProse(body ?? '');

	for (const line of prose.split('\n')) {
		const task = line.match(TASK_ITEM);
		if (task) {
			const content = task[1];
			if (TASK_REF_ITEM.test(content)) {
				// The item itself is the reference: that reference only.
				const ref = content.match(LEADING_REF);
				if (ref) {
					const expected = `${owner}/${repo}`.toLowerCase();
					const shorthandPrefix = ref[1] ? `${ref[1]}/${ref[2]}`.toLowerCase() : null;
					const urlPrefix = ref[4] ? `${ref[4]}/${ref[5]}`.toLowerCase() : null;
					if (
						(shorthandPrefix === null || shorthandPrefix === expected) &&
						(urlPrefix === null || urlPrefix === expected)
					) {
						const n = parseInt(ref[3] ?? ref[6] ?? '0', 10);
						if (n > 0 && n !== self) blockedBy.push({ number: n, source: 'tasklist' });
					}
				}
			} else {
				// Prose task item: still honour explicit keywords inside it.
				collectKeywords(content, self, owner, repo, { blockedBy, blocks });
			}
			continue;
		}
		const label = line.match(DEPS_LABEL);
		if (label) {
			for (const n of extractNumbers(label[2], self, owner, repo)) {
				blockedBy.push({ number: n, source: 'text' });
			}
		}
		collectKeywords(line, self, owner, repo, { blockedBy, blocks });
	}

	return { blockedBy: dedupeRefs(blockedBy), blocks: dedupeRefs(blocks) };
}

function collectKeywords(
	line: string,
	self: number,
	owner: string,
	repo: string,
	into: { blockedBy: DependencyRef[]; blocks: DependencyRef[] }
): void {
	KEYWORDS.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = KEYWORDS.exec(line))) {
		const rest = line.slice(m.index + m[0].length);
		const targets = extractNumbers(rest, self, owner, repo);
		if (!targets.length) continue;
		const bucket = classify(m[1]);
		for (const n of targets) into[bucket].push({ number: n, source: 'text' });
	}
}

/** Dedupe by number, keeping the highest-priority source (native > text > tasklist). */
export function dedupeRefs(refs: DependencyRef[]): DependencyRef[] {
	const map = new Map<number, DependencyRef>();
	for (const ref of refs) {
		const existing = map.get(ref.number);
		if (!existing || SOURCE_PRIORITY[ref.source] > SOURCE_PRIORITY[existing.source]) {
			map.set(ref.number, ref);
		}
	}
	return [...map.values()].sort((a, b) => a.number - b.number);
}
