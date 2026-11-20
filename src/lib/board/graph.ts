import type { ElkNode } from 'elkjs/lib/elk-api';
import { MarkerType } from '@xyflow/svelte';
import type { Edge, Node } from '@xyflow/svelte';
import { resolveRef } from '#lib/github';
import type { DepEdge, IssueRecord, RepoData } from '#lib/github';

/** Fixed card width — node CSS must match. Heights are estimated per card (see estimateCardHeight). */
export const CARD_WIDTH = 240;

const FRAME_HEADER = 30;
const FRAME_PAD = 20;
const CHAIN_GAP = 48;
const INDEP_GAP = 24;
const INDEP_MAX_COLS = 6;

/** Card geometry constants shared with IssueNode.svelte — keep in sync. */
const CARD_PAD = 20;
const ROW_GAP = 4;
const HEADER_H = 18;
const LABELS_H = 18;
const MILESTONE_H = 15;
const HEAT_H = 15;
const BADGES_H = 18;
const TITLE_LINE_H = 17;
const TITLE_MAX_LINES = 3;
const TITLE_CHARS_PER_LINE = 30;

export const NO_MILESTONE = '__none__';
export const UNASSIGNED = '__unassigned__';

export interface BoardFilters {
	milestone: string; // 'all' | milestone title | NO_MILESTONE
	assignee: string; // 'all' | login | UNASSIGNED
	hasOpenPR: boolean;
}

export interface IssueFlowData {
	issue: IssueRecord;
	/** Count of open-issue blockers (regardless of current view filters). */
	openBlockers: number;
	/** Closed-issue blockers that are not visible on the canvas (open-only mode) — shown as a muted badge. */
	resolvedBlockers: number;
	hasOpenPR: boolean;
	[key: string]: unknown;
}

export interface FrameFlowData {
	label: string;
	count: number;
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

function hasBadgeRow(flow: Pick<IssueFlowData, 'resolvedBlockers' | 'issue'>): boolean {
	return flow.resolvedBlockers > 0 || flow.issue.linkedPRs.length > 0;
}

/**
 * Estimated card height: mirrors IssueNode's fixed row heights so ELK positions
 * match the rendered card and no dead space or clipping appears.
 */
export function estimateCardHeight(flow: IssueFlowData): number {
	const titleLines = Math.min(
		TITLE_MAX_LINES,
		Math.max(1, Math.ceil(flow.issue.title.length / TITLE_CHARS_PER_LINE))
	);
	let contentHeight = HEADER_H + titleLines * TITLE_LINE_H + HEAT_H;
	let rows = 3;
	if (flow.issue.labels.length > 0) {
		contentHeight += LABELS_H;
		rows++;
	}
	if (flow.issue.milestone) {
		contentHeight += MILESTONE_H;
		rows++;
	}
	if (hasBadgeRow(flow)) {
		contentHeight += BADGES_H;
		rows++;
	}
	const estimated = CARD_PAD + contentHeight + (rows - 1) * ROW_GAP + 8;
	return Math.max(132, Math.min(210, estimated));
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

interface ComponentLayout {
	/** Node top-left positions relative to the component origin. */
	positions: Map<number, { x: number; y: number }>;
	/** Routed edge polylines relative to the component origin, keyed `from->to`. */
	edgePoints: Map<string, { x: number; y: number }[]>;
	width: number;
	height: number;
}

const ELK_LAYOUT_OPTIONS: Record<string, string> = {
	'elk.algorithm': 'layered',
	'elk.direction': 'DOWN',
	'elk.edgeRouting': 'ORTHOGONAL',
	'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
	'elk.spacing.nodeNode': '56',
	'elk.spacing.edgeNode': '24',
	'elk.spacing.edgeEdge': '14',
	'elk.layered.spacing.nodeNodeBetweenLayers': '88',
	'elk.layered.spacing.edgeNodeBetweenLayers': '20',
	'elk.layered.spacing.edgeEdgeBetweenLayers': '14'
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

async function layoutComponentElk(
	members: number[],
	edges: DepEdge[],
	sizes: Map<number, { width: number; height: number }>
): Promise<ComponentLayout> {
	const memberSet = new Set(members);
	const componentEdges = edges.filter((e) => memberSet.has(e.from) && memberSet.has(e.to));
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
		edges: componentEdges.map((e) => ({
			id: `edge-${e.from}-${e.to}`,
			sources: [portFor(e.from, 'out')],
			targets: [portFor(e.to, 'in')]
		}))
	};
	const elk = await getElk();
	const laid = await elk.layout(graph);
	const positions = new Map<number, { x: number; y: number }>();
	let maxX = 0;
	let maxY = 0;
	for (const child of laid.children ?? []) {
		const n = Number(child.id.replace('issue-', ''));
		if (!Number.isFinite(n)) continue;
		const x = child.x ?? 0;
		const y = child.y ?? 0;
		positions.set(n, { x, y });
		maxX = Math.max(maxX, x + (child.width ?? CARD_WIDTH));
		maxY = Math.max(maxY, y + (child.height ?? 0));
	}
	// Card rectangles for the post-routing no-crossing guarantee.
	const rects = new Map<number, Rect>();
	for (const n of members) {
		const pos = positions.get(n);
		const size = sizes.get(n);
		if (pos && size) rects.set(n, { x: pos.x, y: pos.y, w: size.width, h: size.height });
	}
	const edgePoints = new Map<string, { x: number; y: number }[]>();
	for (const edge of laid.edges ?? []) {
		const points: { x: number; y: number }[] = [];
		for (const section of edge.sections ?? []) {
			points.push({ x: section.startPoint.x, y: section.startPoint.y });
			for (const bend of section.bendPoints ?? []) points.push({ x: bend.x, y: bend.y });
			points.push({ x: section.endPoint.x, y: section.endPoint.y });
		}
		if (points.length >= 2) {
			const key = edge.id.replace(/^edge-/, '').replace('-', '->');
			const [fromPart, toPart] = key.split('->');
			const from = Number(fromPart);
			const to = Number(toPart);
			const obstacles = [...rects.entries()]
				.filter(([id]) => id !== from && id !== to)
				.map(([, rect]) => rect);
			const repaired = avoidCards(points, obstacles);
			edgePoints.set(key, repaired);
			for (const p of repaired) {
				maxX = Math.max(maxX, p.x);
				maxY = Math.max(maxY, p.y);
			}
		}
	}
	return { positions, edgePoints, width: maxX, height: maxY };
}

/**
 * Build Svelte Flow nodes and edges for the current data + view filters.
 * Each dependency chain is laid out with ELK (layered, orthogonal edge routing)
 * and wrapped in a labeled frame; singletons are packed into one "Independent" frame.
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
		return {
			issue,
			openBlockers,
			resolvedBlockers,
			hasOpenPR: issue.linkedPRs.some((pr) => pr.state === 'open')
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

	const nodes: BoardNode[] = [];
	const edges: Edge[] = [];
	let yCursor = 0;
	let chainIndex = 0;

	for (const chain of chains) {
		const component = await layoutComponentElk(chain, boardEdges, sizes);
		const frameId = `chain-${chainIndex}`;
		const framePos = { x: 0, y: yCursor };
		const frameWidth = component.width + FRAME_PAD * 2;
		const frameHeight = component.height + FRAME_PAD * 2 + FRAME_HEADER;
		nodes.push({
			id: frameId,
			type: 'frame',
			position: framePos,
			width: frameWidth,
			height: frameHeight,
			style: `width:${frameWidth}px;height:${frameHeight}px`,
			data: { label: `Chain · ${chain.length} issues`, count: chain.length },
			draggable: true,
			selectable: false
		});
		for (const n of chain) {
			const flowData = dataByNumber.get(n);
			const pos = component.positions.get(n);
			const size = sizes.get(n);
			if (!flowData || !pos || !size) continue;
			nodes.push({
				id: `issue-${n}`,
				type: 'issue',
				parentId: frameId,
				extent: 'parent',
				position: { x: pos.x + FRAME_PAD, y: pos.y + FRAME_PAD + FRAME_HEADER },
				width: size.width,
				height: size.height,
				style: `width:${size.width}px;height:${size.height}px`,
				data: flowData
			});
		}
		for (const edge of boardEdges) {
			if (!chain.includes(edge.from) || !chain.includes(edge.to)) continue;
			const points = component.edgePoints.get(`${edge.from}->${edge.to}`);
			if (!points) continue;
			const originX = framePos.x + FRAME_PAD;
			const originY = framePos.y + FRAME_HEADER + FRAME_PAD;
			const blocked = dataByNumber.get(edge.to);
			const blocking = !!blocked && blocked.issue.state === 'open' && blocked.openBlockers > 0;
			const color = blocking ? '#ef4444' : '#a3a3a3';
			edges.push({
				id: `edge-${edge.from}-${edge.to}`,
				source: `issue-${edge.from}`,
				target: `issue-${edge.to}`,
				type: 'rounded',
				data: { points: points.map((p) => ({ x: p.x + originX, y: p.y + originY })) },
				markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
				style: `stroke: ${color}; stroke-width: 1.5;`
			});
		}
		yCursor += frameHeight + CHAIN_GAP;
		chainIndex++;
	}

	if (singles.length > 0) {
		const cols = Math.min(INDEP_MAX_COLS, Math.max(2, Math.ceil(Math.sqrt(singles.length))));
		const rows: number[][] = [];
		for (let i = 0; i < singles.length; i += cols) rows.push(singles.slice(i, i + cols));
		const rowHeights = rows.map((row) => Math.max(...row.map((n) => sizes.get(n)?.height ?? 0)));
		const contentWidth = cols * CARD_WIDTH + (cols - 1) * INDEP_GAP;
		const contentHeight = rowHeights.reduce((sum, h) => sum + h, 0) + (rows.length - 1) * INDEP_GAP;
		const frameWidth = contentWidth + FRAME_PAD * 2;
		const frameHeight = contentHeight + FRAME_PAD * 2 + FRAME_HEADER;
		const framePos = { x: 0, y: yCursor };
		const frameId = 'chain-independent';
		nodes.push({
			id: frameId,
			type: 'frame',
			position: framePos,
			width: frameWidth,
			height: frameHeight,
			style: `width:${frameWidth}px;height:${frameHeight}px`,
			data: { label: `Independent · ${singles.length} issues`, count: singles.length },
			draggable: true,
			selectable: false
		});
		let rowY = FRAME_HEADER + FRAME_PAD;
		rows.forEach((row, rowIndex) => {
			const rowWidth = row.length * CARD_WIDTH + (row.length - 1) * INDEP_GAP;
			let x = FRAME_PAD + (contentWidth - rowWidth) / 2;
			for (const n of row) {
				const flowData = dataByNumber.get(n);
				const size = sizes.get(n);
				if (!flowData || !size) continue;
				nodes.push({
					id: `issue-${n}`,
					type: 'issue',
					parentId: frameId,
					extent: 'parent',
					position: { x, y: rowY },
					width: size.width,
					height: size.height,
					style: `width:${size.width}px;height:${size.height}px`,
					data: flowData
				});
				x += CARD_WIDTH + INDEP_GAP;
			}
			rowY += rowHeights[rowIndex] + INDEP_GAP;
		});
	}

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
