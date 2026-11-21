import type { ElkNode } from 'elkjs/lib/elk-api';
import { MarkerType } from '@xyflow/svelte';
import type { Edge, Node } from '@xyflow/svelte';
import { resolveRef } from '#lib/github';
import type { DepEdge, IssueRecord, RepoData } from '#lib/github';

/** Fixed card width — node CSS must match. Heights are estimated per card (see estimateCardHeight). */
export const CARD_WIDTH = 240;

const FRAME_HEADER = 26;
const FRAME_PAD = 16;
const BLOCK_GAP = 72;
const INDEP_GAP = 20;

/** Card geometry constants shared with IssueNode.svelte — keep in sync. */
const CARD_PAD = 8;
const CARD_BORDER = 1;
const ROW_GAP = 4;
const HEADER_H = 16;
const LABELS_H = 17;
const FOOTER_H = 16;
const TITLE_LINE_H = 17;
const TITLE_MAX_LINES = 4;
const TITLE_CHARS_PER_LINE = 28;

/** Landscape shape ELK packs connected components into. */
const TARGET_ASPECT = 1.9;
/** Shape the final canvas aims for once the loose block is included. */
const BOARD_ASPECT = 1.4;
/** Space ELK leaves between connected components. */
const COMPONENT_GAP = 96;
/** One quiet stroke for every dependency; state lives on the card, not the arrow. */
const EDGE_COLOR = '#8c97a8';

export const NO_MILESTONE = '__none__';
export const UNASSIGNED = '__unassigned__';

export interface BoardFilters {
	milestone: string; // 'all' | milestone title | NO_MILESTONE
	assignee: string; // 'all' | login | UNASSIGNED
	hasOpenPR: boolean;
}

export type IssueState = 'blocked' | 'in-progress' | 'in-review' | 'unassigned' | 'closed';

export interface IssueFlowData {
	issue: IssueRecord;
	/** Compact state shown as a word and the card's pastel fill. */
	state: IssueState;
	/** Estimated title wrapping, also used as the CSS line clamp. */
	titleLines: number;
	/** Count of open-issue blockers (regardless of current view filters). */
	openBlockers: number;
	/** Closed-issue blockers that are not visible on the canvas (open-only mode). */
	resolvedBlockers: number;
	hasOpenPR: boolean;
	[key: string]: unknown;
}

export interface FrameFlowData {
	label: string;
	count: number;
	kind: 'chain' | 'independent';
	[key: string]: unknown;
}

export type IssueNode = Node<IssueFlowData, 'issue'>;
export type FrameNode = Node<FrameFlowData, 'frame'>;
export type BoardNode = IssueNode | FrameNode;

export interface BoardCounts {
	issues: number;
	edges: number;
	chains: number;
	independent: number;
}

export interface BoardModel {
	nodes: BoardNode[];
	edges: Edge[];
	counts: BoardCounts;
}

export interface FilterOptions {
	milestones: { value: string; label: string }[];
	assignees: { value: string; label: string }[];
}

/** Dropdown options derived from the loaded dataset. */
export function filterOptions(data: RepoData): FilterOptions {
	const milestoneTitles = new Set<string>();
	let hasUnmilestoned = false;
	const logins = new Set<string>();
	let hasUnassigned = false;
	for (const issue of data.issues) {
		if (issue.milestone) milestoneTitles.add(issue.milestone.title);
		else hasUnmilestoned = true;
		if (issue.assignees.length === 0) hasUnassigned = true;
		for (const user of issue.assignees) logins.add(user.login);
	}
	return {
		milestones: [
			...[...milestoneTitles].sort().map((title) => ({ value: title, label: title })),
			...(hasUnmilestoned ? [{ value: NO_MILESTONE, label: 'No milestone' }] : [])
		],
		assignees: [
			...[...logins].sort().map((login) => ({ value: login, label: login })),
			...(hasUnassigned ? [{ value: UNASSIGNED, label: 'Unassigned' }] : [])
		]
	};
}

function passesFilters(issue: IssueRecord, filters: BoardFilters): boolean {
	if (filters.milestone !== 'all') {
		const value = issue.milestone ? issue.milestone.title : NO_MILESTONE;
		if (value !== filters.milestone) return false;
	}
	if (filters.assignee !== 'all') {
		if (filters.assignee === UNASSIGNED) {
			if (issue.assignees.length > 0) return false;
		} else if (!issue.assignees.some((user) => user.login === filters.assignee)) {
			return false;
		}
	}
	if (filters.hasOpenPR && !issue.linkedPRs.some((pr) => pr.state === 'open')) return false;
	return true;
}

/** How many lines the title needs at the compact card width. */
export function titleLineCount(title: string): number {
	return Math.min(TITLE_MAX_LINES, Math.max(1, Math.ceil(title.length / TITLE_CHARS_PER_LINE)));
}

/** The footer is only worth a row when it says something the header does not. */
function hasFooter(flow: IssueFlowData): boolean {
	return (
		flow.issue.assignees.length > 0 ||
		flow.issue.linkedPRs.length > 0 ||
		flow.resolvedBlockers > 0 ||
		!!flow.issue.milestone
	);
}

/**
 * Estimated card height: mirrors IssueNode's fixed row heights so ELK positions
 * match the rendered card and no dead space or clipping appears.
 *
 * Compact anatomy: header row, title (1–4 lines), optional one label row, optional
 * footer. Rows are counted rather than hard-coded so the two stay in sync.
 */
export function estimateCardHeight(flow: IssueFlowData): number {
	const labels = flow.issue.labels.length > 0 ? 1 : 0;
	const footer = hasFooter(flow) ? 1 : 0;
	const gaps = 1 + labels + footer;
	return (
		CARD_PAD * 2 +
		CARD_BORDER * 2 +
		HEADER_H +
		flow.titleLines * TITLE_LINE_H +
		labels * LABELS_H +
		footer * FOOTER_H +
		gaps * ROW_GAP
	);
}

/** Union-find over visible dependency edges. */
function connectedComponents(ids: number[], edges: DepEdge[]): number[][] {
	const parent = new Map<number, number>();
	const rank = new Map<number, number>();
	const find = (n: number): number => {
		let root = n;
		while (parent.get(root) !== root) root = parent.get(root) ?? root;
		parent.set(n, root);
		return root;
	};
	const union = (a: number, b: number): void => {
		const ra = find(a);
		const rb = find(b);
		if (ra === rb) return;
		const rkA = rank.get(ra) ?? 0;
		const rkB = rank.get(rb) ?? 0;
		if (rkA < rkB) parent.set(ra, rb);
		else if (rkA > rkB) parent.set(rb, ra);
		else {
			parent.set(rb, ra);
			rank.set(ra, rkA + 1);
		}
	};
	for (const id of ids) {
		parent.set(id, id);
		rank.set(id, 0);
	}
	const idSet = new Set(ids);
	for (const edge of edges) {
		if (idSet.has(edge.from) && idSet.has(edge.to)) union(edge.from, edge.to);
	}
	const groups = new Map<number, number[]>();
	for (const id of ids) {
		const root = find(id);
		const list = groups.get(root) ?? [];
		list.push(id);
		groups.set(root, list);
	}
	return [...groups.values()]
		.map((group) => group.sort((a, b) => a - b))
		.sort((a, b) => b.length - a.length || a[0] - b[0]);
}

const ELK_LAYOUT_OPTIONS: Record<string, string> = {
	'elk.algorithm': 'layered',
	'elk.direction': 'DOWN',
	'elk.edgeRouting': 'ORTHOGONAL',
	'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
	'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
	'elk.spacing.nodeNode': '28',
	'elk.spacing.edgeNode': '20',
	'elk.spacing.edgeEdge': '16',
	'elk.layered.spacing.nodeNodeBetweenLayers': '76',
	'elk.layered.spacing.edgeNodeBetweenLayers': '20',
	'elk.layered.spacing.edgeEdgeBetweenLayers': '16',
	// One layout for every chain, packed to a landscape canvas instead of a
	// tall stack of frames.
	'elk.separateConnectedComponents': 'true',
	'elk.spacing.componentComponent': String(COMPONENT_GAP),
	'elk.aspectRatio': String(TARGET_ASPECT)
};

/** Edges always leave the bottom-center and enter the top-center of a card. */
function portFor(node: number, side: 'in' | 'out'): string {
	return `${side}-${node}`;
}

interface Pt {
	x: number;
	y: number;
}

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Clearance used when detouring around a card. */
const REPAIR_GAP = 16;

function dedupePoints(points: Pt[]): Pt[] {
	const out: Pt[] = [];
	for (const p of points) {
		const last = out[out.length - 1];
		if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
		out.push(p);
	}
	return out;
}

/** Does an axis-aligned segment overlap a rectangle (slightly inset)? */
function segmentHitsRect(a: Pt, b: Pt, r: Rect): boolean {
	const eps = 0.5;
	const minX = Math.min(a.x, b.x);
	const maxX = Math.max(a.x, b.x);
	const minY = Math.min(a.y, b.y);
	const maxY = Math.max(a.y, b.y);
	return maxX > r.x + eps && minX < r.x + r.w - eps && maxY > r.y + eps && minY < r.y + r.h - eps;
}

function allClear(pieces: [Pt, Pt][], obstacles: Rect[]): boolean {
	return pieces.every(([a, b]) => !obstacles.some((r) => segmentHitsRect(a, b, r)));
}

function piecesOf(points: Pt[]): [Pt, Pt][] {
	return points.slice(0, -1).map((p, i) => [p, points[i + 1]] as [Pt, Pt]);
}

/**
 * Post-routing guarantee: no edge segment may pass through a card rectangle.
 * ELK's orthogonal router occasionally drops a long edge straight through the
 * card that sits above its target. This repair detours any intersecting segment
 * around the blocking cards (with clearance) and repeats for new segments.
 */
function gapMids(intervals: [number, number][]): number[] {
	const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
	const merged: [number, number][] = [];
	for (const it of sorted) {
		const last = merged[merged.length - 1];
		if (last && it[0] <= last[1]) last[1] = Math.max(last[1], it[1]);
		else merged.push([it[0], it[1]]);
	}
	const mids: number[] = [];
	for (let i = 0; i < merged.length - 1; i++) {
		const gap = merged[i + 1][0] - merged[i][1];
		if (gap >= 2) mids.push(merged[i][1] + gap / 2);
	}
	return mids;
}

function pickLane(list: number[], boundA: number, boundB: number, prefer: number): number | null {
	const lo = Math.min(boundA, boundB);
	const hi = Math.max(boundA, boundB);
	const candidates = list.filter((m) => m >= lo && m <= hi);
	if (candidates.length === 0) return null;
	return candidates.sort((p, q) => Math.abs(p - prefer) - Math.abs(q - prefer))[0];
}

function repairVertical(
	a: Pt,
	b: Pt,
	blockers: Rect[],
	colMids: number[],
	rowMids: number[],
	obstacles: Rect[]
): Pt[] | null {
	const dir: 1 | -1 = b.y > a.y ? 1 : -1;
	const minTop = Math.min(...blockers.map((r) => r.y));
	const maxBottom = Math.max(...blockers.map((r) => r.y + r.h));
	const near = dir > 0 ? minTop : maxBottom;
	const far = dir > 0 ? maxBottom : minTop;
	const laneIn = pickLane(rowMids, a.y, near - dir * REPAIR_GAP, a.y + dir * REPAIR_GAP);
	const laneOut = pickLane(rowMids, far + dir * REPAIR_GAP, b.y, b.y - dir * REPAIR_GAP);
	if (laneIn === null || laneOut === null) return null;
	if (dir > 0 ? laneIn >= laneOut : laneOut >= laneIn) return null;
	const corridor = colMids
		.filter((x) => x > 1)
		.sort((p, q) => Math.abs(p - a.x) - Math.abs(q - a.x));
	for (const x of corridor) {
		const candidate: Pt[] = [
			a,
			{ x: a.x, y: laneIn },
			{ x, y: laneIn },
			{ x, y: laneOut },
			{ x: a.x, y: laneOut },
			b
		];
		if (allClear(piecesOf(candidate), obstacles)) return candidate;
	}
	return null;
}

function repairHorizontal(
	a: Pt,
	b: Pt,
	blockers: Rect[],
	colMids: number[],
	rowMids: number[],
	obstacles: Rect[]
): Pt[] | null {
	const dir: 1 | -1 = b.x > a.x ? 1 : -1;
	const minLeft = Math.min(...blockers.map((r) => r.x));
	const maxRight = Math.max(...blockers.map((r) => r.x + r.w));
	const near = dir > 0 ? minLeft : maxRight;
	const far = dir > 0 ? maxRight : minLeft;
	const laneIn = pickLane(colMids, a.x, near - dir * REPAIR_GAP, a.x + dir * REPAIR_GAP);
	const laneOut = pickLane(colMids, far + dir * REPAIR_GAP, b.x, b.x - dir * REPAIR_GAP);
	if (laneIn === null || laneOut === null) return null;
	if (dir > 0 ? laneIn >= laneOut : laneOut >= laneIn) return null;
	const corridor = rowMids
		.filter((y) => y > 1)
		.sort((p, q) => Math.abs(p - a.y) - Math.abs(q - a.y));
	for (const y of corridor) {
		const candidate: Pt[] = [
			a,
			{ x: laneIn, y: a.y },
			{ x: laneIn, y },
			{ x: laneOut, y },
			{ x: laneOut, y: a.y },
			b
		];
		if (allClear(piecesOf(candidate), obstacles)) return candidate;
	}
	return null;
}

/**
 * Post-routing guarantee: no edge segment may pass through a card rectangle.
 * Uses global free corridors (gap midpoints between all card bands), so any
 * detour stays clear of every card.
 */
function avoidCards(points: Pt[], obstacles: Rect[]): Pt[] {
	if (obstacles.length === 0) return points;
	const colMids = gapMids(obstacles.map((r) => [r.x, r.x + r.w]));
	const rowMids = gapMids(obstacles.map((r) => [r.y, r.y + r.h]));
	let pts = dedupePoints(points);
	for (let pass = 0; pass < 6; pass++) {
		let changed = false;
		const next: Pt[] = [pts[0]];
		for (let i = 1; i < pts.length; i++) {
			const a = pts[i - 1];
			const b = pts[i];
			const vertical = Math.abs(a.x - b.x) < 0.5;
			const horizontal = Math.abs(a.y - b.y) < 0.5;
			if (!vertical && !horizontal) {
				next.push(b);
				continue;
			}
			const blockers = obstacles.filter((r) => segmentHitsRect(a, b, r));
			if (blockers.length === 0) {
				next.push(b);
				continue;
			}
			const routed = vertical
				? repairVertical(a, b, blockers, colMids, rowMids, obstacles)
				: repairHorizontal(a, b, blockers, colMids, rowMids, obstacles);
			if (routed) {
				next.push(...routed.slice(1));
				changed = true;
			} else {
				next.push(b);
			}
		}
		pts = dedupePoints(next);
		if (!changed) break;
	}
	return pts;
}

/**
 * ELK is heavy (~1.4 MB min) — load it lazily so the board shell paints while
 * the GitHub fetch and this chunk download in parallel.
 */
type ElkInstance = { layout: (graph: ElkNode) => Promise<ElkNode> };
let elkInstance: ElkInstance | null = null;
async function getElk(): Promise<ElkInstance> {
	if (!elkInstance) {
		const mod = await import('elkjs/lib/elk.bundled.js');
		elkInstance = new mod.default();
	}
	return elkInstance;
}

interface ChainLayout {
	members: number[];
	/** Global node top-left positions produced by the single ELK pass. */
	positions: Map<number, Pt>;
	/** Global routed polylines, keyed `from->to`. */
	edgePoints: Map<string, Pt[]>;
	frame: Rect;
}

/**
 * Lay out every dependency chain in one ELK pass. `separateConnectedComponents`
 * lets ELK pack the chains against a landscape aspect ratio instead of stacking
 * them vertically, which is what keeps a 117-issue backlog from opening as a
 * tall strip.
 */
async function layoutChains(
	chains: number[][],
	edges: DepEdge[],
	sizes: Map<number, { width: number; height: number }>
): Promise<ChainLayout[]> {
	if (chains.length === 0) return [];
	const members = chains.flat();
	const memberSet = new Set(members);
	const componentOf = new Map<number, number>();
	chains.forEach((group, index) => {
		for (const n of group) componentOf.set(n, index);
	});
	const chainEdges = edges.filter((e) => memberSet.has(e.from) && memberSet.has(e.to));

	const graph: ElkNode = {
		id: 'root',
		layoutOptions: ELK_LAYOUT_OPTIONS,
		children: members.flatMap((n) => {
			const size = sizes.get(n);
			if (!size) return [];
			return [
				{
					id: `issue-${n}`,
					width: size.width,
					height: size.height,
					layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
					ports: [
						{
							id: portFor(n, 'out'),
							x: size.width / 2,
							y: size.height,
							width: 1,
							height: 1,
							layoutOptions: { 'elk.port.side': 'SOUTH' }
						},
						{
							id: portFor(n, 'in'),
							x: size.width / 2,
							y: 0,
							width: 1,
							height: 1,
							layoutOptions: { 'elk.port.side': 'NORTH' }
						}
					]
				}
			];
		}),
		edges: chainEdges.map((e) => ({
			id: `edge-${e.from}-${e.to}`,
			sources: [portFor(e.from, 'out')],
			targets: [portFor(e.to, 'in')]
		}))
	};

	const elk = await getElk();
	const laid = await elk.layout(graph);
	const positions = new Map<number, Pt>();
	for (const child of laid.children ?? []) {
		const n = Number(child.id.replace('issue-', ''));
		if (!Number.isFinite(n)) continue;
		positions.set(n, { x: child.x ?? 0, y: child.y ?? 0 });
	}

	const rectById = new Map<number, Rect>();
	for (const n of members) {
		const pos = positions.get(n);
		const size = sizes.get(n);
		if (pos && size) rectById.set(n, { x: pos.x, y: pos.y, w: size.width, h: size.height });
	}

	const edgePoints = chains.map(() => new Map<string, Pt[]>());
	for (const edge of laid.edges ?? []) {
		const points: Pt[] = [];
		for (const section of edge.sections ?? []) {
			points.push({ x: section.startPoint.x, y: section.startPoint.y });
			for (const bend of section.bendPoints ?? []) points.push({ x: bend.x, y: bend.y });
			points.push({ x: section.endPoint.x, y: section.endPoint.y });
		}
		if (points.length < 2) continue;
		const key = edge.id.replace(/^edge-/, '').replace('-', '->');
		const [fromPart, toPart] = key.split('->');
		const from = Number(fromPart);
		const to = Number(toPart);
		const component = componentOf.get(from);
		if (component === undefined) continue;
		const obstacles = [...rectById.entries()]
			.filter(([id]) => id !== from && id !== to)
			.map(([, rect]) => rect);
		edgePoints[component].set(key, avoidCards(points, obstacles));
	}

	return chains.map((group, component) => {
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const n of group) {
			const pos = positions.get(n);
			const size = sizes.get(n);
			if (!pos || !size) continue;
			minX = Math.min(minX, pos.x);
			minY = Math.min(minY, pos.y);
			maxX = Math.max(maxX, pos.x + size.width);
			maxY = Math.max(maxY, pos.y + size.height);
		}
		for (const points of edgePoints[component].values()) {
			for (const p of points) {
				minX = Math.min(minX, p.x);
				minY = Math.min(minY, p.y);
				maxX = Math.max(maxX, p.x);
				maxY = Math.max(maxY, p.y);
			}
		}
		return {
			members: group,
			positions,
			edgePoints: edgePoints[component],
			frame: {
				x: minX - FRAME_PAD,
				y: minY - FRAME_PAD - FRAME_HEADER,
				w: maxX - minX + FRAME_PAD * 2,
				h: maxY - minY + FRAME_PAD * 2 + FRAME_HEADER
			}
		};
	});
}

interface FrameLayout {
	id: string;
	label: string;
	count: number;
	kind: 'chain' | 'independent';
	x: number;
	y: number;
	w: number;
	h: number;
	children: { n: number; x: number; y: number }[];
}

/**
 * Build Svelte Flow nodes and edges for the current data + view filters.
 * All dependency chains share one ELK pass packed to a landscape shape; each
 * chain is wrapped in a labeled frame afterwards. Singletons are packed into a
 * dense shortest-column block below the drawn graph.
 */
export async function buildBoard(data: RepoData, filters: BoardFilters): Promise<BoardModel> {
	const visible = data.issues.filter((issue) => passesFilters(issue, filters));
	const visibleSet = new Set(visible.map((issue) => issue.number));
	const boardEdges = data.edges.filter(
		(edge) => visibleSet.has(edge.from) && visibleSet.has(edge.to)
	);

	const issueData = (issue: IssueRecord): IssueFlowData => {
		let openBlockers = 0;
		let resolvedBlockers = 0;
		for (const ref of issue.blockedBy) {
			const target = resolveRef(data, ref.number);
			if (target.kind !== 'issue') continue;
			if (target.issue.state === 'open') openBlockers++;
			else if (!visibleSet.has(target.issue.number)) resolvedBlockers++;
		}
		const hasOpenPR = issue.linkedPRs.some((pr) => pr.state === 'open');
		const state: IssueState =
			issue.state === 'closed'
				? 'closed'
				: openBlockers > 0
					? 'blocked'
					: hasOpenPR
						? 'in-review'
						: issue.assignees.length > 0
							? 'in-progress'
							: 'unassigned';
		return {
			issue,
			state,
			titleLines: titleLineCount(issue.title),
			openBlockers,
			resolvedBlockers,
			hasOpenPR
		};
	};

	const components = connectedComponents(
		visible.map((issue) => issue.number),
		boardEdges
	);
	const dataByNumber = new Map<number, IssueFlowData>();
	const sizes = new Map<number, { width: number; height: number }>();
	for (const issue of visible) {
		const flowData = issueData(issue);
		dataByNumber.set(issue.number, flowData);
		sizes.set(issue.number, { width: CARD_WIDTH, height: estimateCardHeight(flowData) });
	}
	const chains = components.filter((group) => group.length > 1);
	const singles = components.filter((group) => group.length === 1).map((group) => group[0]);

	const chainLayouts = await layoutChains(chains, boardEdges, sizes);

	const frames: FrameLayout[] = chainLayouts.map((layout, index) => ({
		id: `chain-${index}`,
		label: `Chain · ${layout.members.length} issues`,
		count: layout.members.length,
		kind: 'chain',
		x: layout.frame.x,
		y: layout.frame.y,
		w: layout.frame.w,
		h: layout.frame.h,
		children: layout.members.flatMap((n) => {
			const pos = layout.positions.get(n);
			if (!pos) return [];
			return [{ n, x: pos.x - layout.frame.x, y: pos.y - layout.frame.y }];
		})
	}));

	if (singles.length > 0) {
		const chainBottom = chainLayouts.length
			? Math.max(...chainLayouts.map((layout) => layout.frame.y + layout.frame.h))
			: 0;
		const chainRight = chainLayouts.length
			? Math.max(...chainLayouts.map((layout) => layout.frame.x + layout.frame.w))
			: 0;
		const blockY = chainLayouts.length > 0 ? chainBottom + BLOCK_GAP : 0;

		// Pick the column count that brings the whole canvas closest to a
		// landscape 1.9 aspect. A fixed column count makes a large backlog tall
		// and narrow however wide the drawn chains are.
		const pack = (columns: number) => {
			const heights = new Array<number>(columns).fill(0);
			const placed: { n: number; x: number; y: number }[] = [];
			for (const n of singles) {
				const size = sizes.get(n);
				if (!size) continue;
				let column = 0;
				for (let i = 1; i < columns; i++) {
					if (heights[i] < heights[column]) column = i;
				}
				placed.push({ n, x: column * (CARD_WIDTH + INDEP_GAP), y: heights[column] });
				heights[column] += size.height + INDEP_GAP;
			}
			const width = columns * CARD_WIDTH + (columns - 1) * INDEP_GAP;
			const height = Math.max(0, Math.max(...heights) - INDEP_GAP);
			return { placed, width, height };
		};

		let best = pack(1);
		let bestScore = Number.POSITIVE_INFINITY;
		const maxColumns = Math.min(singles.length, 32);
		for (let columns = 1; columns <= maxColumns; columns++) {
			const candidate = pack(columns);
			const totalWidth = Math.max(chainRight, candidate.width + FRAME_PAD * 2);
			const totalHeight = blockY + candidate.height + FRAME_PAD;
			const aspect = totalWidth / Math.max(1, totalHeight);
			const score = Math.abs(Math.log(aspect / BOARD_ASPECT));
			if (score < bestScore) {
				bestScore = score;
				best = candidate;
			}
		}
		const contentWidth = best.width;
		const contentHeight = best.height;
		frames.push({
			id: 'chain-independent',
			label: `Independent · ${singles.length} issues`,
			count: singles.length,
			kind: 'independent',
			x: -FRAME_PAD,
			y: blockY - FRAME_PAD - FRAME_HEADER,
			w: contentWidth + FRAME_PAD * 2,
			h: contentHeight + FRAME_PAD * 2 + FRAME_HEADER,
			children: best.placed.map((p) => ({
				n: p.n,
				x: p.x + FRAME_PAD,
				y: p.y + FRAME_PAD + FRAME_HEADER
			}))
		});
	}

	// Center the narrower block against the wider one: a 14-column independent
	// grid should not leave the chains stranded in the top-left corner.
	let chainShiftX = 0;
	const chainFrames = frames.filter((frame) => frame.kind === 'chain');
	const independentFrame = frames.find((frame) => frame.kind === 'independent');
	if (chainFrames.length > 0 && independentFrame) {
		const chainLeft = Math.min(...chainFrames.map((frame) => frame.x));
		const chainRight = Math.max(...chainFrames.map((frame) => frame.x + frame.w));
		const independentLeft = independentFrame.x;
		const independentRight = independentFrame.x + independentFrame.w;
		const chainWidth = chainRight - chainLeft;
		const independentWidth = independentRight - independentLeft;
		if (independentWidth > chainWidth) {
			chainShiftX = (independentLeft + independentRight) / 2 - (chainLeft + chainRight) / 2;
			for (const frame of chainFrames) frame.x += chainShiftX;
		} else if (chainWidth > independentWidth) {
			independentFrame.x += (chainLeft + chainRight) / 2 - (independentLeft + independentRight) / 2;
		}
	}

	const offsetX = frames.length > 0 ? Math.min(...frames.map((frame) => frame.x)) : 0;
	const offsetY = frames.length > 0 ? Math.min(...frames.map((frame) => frame.y)) : 0;

	const nodes: BoardNode[] = [];
	for (const frame of frames) {
		nodes.push({
			id: frame.id,
			type: 'frame',
			position: { x: frame.x - offsetX, y: frame.y - offsetY },
			width: frame.w,
			height: frame.h,
			style: `width:${frame.w}px;height:${frame.h}px`,
			data: { label: frame.label, count: frame.count, kind: frame.kind },
			draggable: true,
			selectable: false
		});
	}
	for (const frame of frames) {
		for (const child of frame.children) {
			const flowData = dataByNumber.get(child.n);
			const size = sizes.get(child.n);
			if (!flowData || !size) continue;
			nodes.push({
				id: `issue-${child.n}`,
				type: 'issue',
				parentId: frame.id,
				extent: 'parent',
				position: { x: child.x, y: child.y },
				width: size.width,
				height: size.height,
				style: `width:${size.width}px;height:${size.height}px`,
				data: flowData
			});
		}
	}

	const edges: Edge[] = [];
	chainLayouts.forEach((layout) => {
		const members = new Set(layout.members);
		for (const edge of boardEdges) {
			if (!members.has(edge.from) || !members.has(edge.to)) continue;
			const points = layout.edgePoints.get(`${edge.from}->${edge.to}`);
			if (!points) continue;
			edges.push({
				id: `edge-${edge.from}-${edge.to}`,
				source: `issue-${edge.from}`,
				target: `issue-${edge.to}`,
				type: 'rounded',
				data: {
					points: points.map((p) => ({
						x: p.x - offsetX + chainShiftX,
						y: p.y - offsetY
					}))
				},
				markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: EDGE_COLOR },
				style: `stroke: ${EDGE_COLOR}; stroke-width: 1.3; opacity: 0.75;`
			});
		}
	});

	return {
		nodes,
		edges,
		counts: {
			issues: visible.length,
			edges: boardEdges.length,
			chains: chains.length,
			independent: singles.length
		}
	};
}
