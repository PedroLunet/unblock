/**
 * Shared card geometry. The layout engine estimates each node's height from
 * these values and IssueCard.svelte renders rows at exactly the same heights,
 * so ELK never positions a card at a size the DOM does not fill.
 */
export const CARD_WIDTH = 272;

/** Inner padding on all sides, applied by IssueCard. */
export const CARD_PAD = 12;
/** Vertical gap between card rows, applied by IssueCard. */
export const CARD_GAP = 6;
/** Border width, applied by IssueCard and reserved by the height model. */
export const CARD_BORDER = 2;

export const CARD_MIN_HEIGHT = 140;
export const CARD_MAX_HEIGHT = 224;

export const HEADER_HEIGHT = 20;
export const TITLE_LINE_HEIGHT = 19;
export const LABELS_HEIGHT = 20;
export const MILESTONE_HEIGHT = 17;
export const META_HEIGHT = 16;
export const BADGES_HEIGHT = 20;

export const TITLE_MAX_LINES = 3;
/**
 * Conservative weighted glyph budget per line. Lowercase Latin averages ~1
 * unit, uppercase is wider, and CJK/emoji take roughly two Latin glyphs. The
 * real line fits ~34 lowercase characters, so this deliberately wraps early
 * rather than ever clipping a title.
 */
const TITLE_LINE_CAPACITY = 30;

const WIDE_CHAR =
	/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u;

export interface CardRows {
	titleLines: number;
	labels: boolean;
	milestone: boolean;
	badges: boolean;
}

function titleWeight(title: string): number {
	let weight = 0;
	for (const char of title) {
		const code = char.codePointAt(0) ?? 0;
		if (WIDE_CHAR.test(char) || code >= 0x1f000 || (code >= 0x2600 && code <= 0x27bf)) {
			weight += 2;
		} else if (char === ' ') weight += 0.6;
		else if (char >= 'A' && char <= 'Z') weight += 1.15;
		else if (char >= '0' && char <= '9') weight += 1.05;
		else weight += 1;
	}
	return weight;
}

export function estimateTitleLines(title: string): number {
	return Math.min(
		TITLE_MAX_LINES,
		Math.max(1, Math.ceil(titleWeight(title) / TITLE_LINE_CAPACITY))
	);
}

export function cardRows(issue: {
	title: string;
	labels: unknown[];
	milestone: unknown;
	linkedPRs: unknown[];
}): CardRows {
	return {
		titleLines: estimateTitleLines(issue.title),
		labels: issue.labels.length > 0,
		milestone: issue.milestone !== null,
		badges: issue.linkedPRs.length > 0
	};
}

export function estimateCardHeight(rows: CardRows): number {
	let content = HEADER_HEIGHT + rows.titleLines * TITLE_LINE_HEIGHT + META_HEIGHT;
	let sections = 3; // header, title, meta
	if (rows.labels) {
		content += LABELS_HEIGHT;
		sections++;
	}
	if (rows.milestone) {
		content += MILESTONE_HEIGHT;
		sections++;
	}
	if (rows.badges) {
		content += BADGES_HEIGHT;
		sections++;
	}
	const height = CARD_BORDER * 2 + CARD_PAD * 2 + content + (sections - 1) * CARD_GAP;
	return Math.max(CARD_MIN_HEIGHT, Math.min(CARD_MAX_HEIGHT, height));
}
