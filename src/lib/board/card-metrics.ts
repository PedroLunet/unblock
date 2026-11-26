/**
 * Shared card geometry. Every card has the same footprint so the board reads
 * as one rhythm instead of a ragged stack, and ELK positions nodes at exactly
 * the size the DOM fills.
 */
export const CARD_WIDTH = 284;

/** Fixed outer height: three lines of title, labels, milestone and a pinned footer. */
export const CARD_HEIGHT = 208;

/** Inner padding on all sides, applied by IssueCard. */
export const CARD_PAD = 14;
/** Vertical gap between card rows, applied by IssueCard. */
export const CARD_GAP = 8;
/** Border width, applied by IssueCard and reserved by the height model. */
export const CARD_BORDER = 2;

export const HEADER_HEIGHT = 20;
export const TITLE_LINE_HEIGHT = 20;
export const TITLE_MAX_LINES = 3;
export const LABELS_HEIGHT = 20;
export const MILESTONE_HEIGHT = 18;
export const FOOTER_HEIGHT = 20;
