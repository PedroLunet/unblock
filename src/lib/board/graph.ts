import type { ElkNode } from 'elkjs/lib/elk-api';
import { MarkerType } from '@xyflow/svelte';
import type { Edge, Node } from '@xyflow/svelte';
import { resolveRef } from '#lib/github';
import type { DepEdge, IssueRecord, RepoData } from '#lib/github';

/** Fixed card width — node CSS must match. Heights are estimated per card (see estimateCardHeight). */
export const CARD_WIDTH = 240;

const FRAME_HEADER = 30;
const FRAME_PAD = 20;
const BLOCK_GAP = 72;
const INDEP_GAP = 24;

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

/** Landscape shape ELK packs connected components into. */
const TARGET_ASPECT = 1.9;
/** Shape the final canvas aims for once the loose block is included. */
const BOARD_ASPECT = 1.4;

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
	/** Closed-issue blockers that are not visible on the canvas (open-only mode). */
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

const ELK_LAYOUT_OPTIONS: Record<string, string> = {
	'elk.algorithm': 'layered',
	'elk.direction': 'DOWN',
	'elk.edgeRouting': 'ORTHOGONAL',
	'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
	'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
	'elk.spacing.nodeNode': '20',
	'elk.spacing.edgeNode': '12',
	'elk.spacing.edgeEdge': '10',
	'elk.layered.spacing.nodeNodeBetweenLayers': '56',
	'elk.layered.spacing.edgeNodeBetweenLayers': '12',
	'elk.layered.spacing.edgeEdgeBetweenLayers': '10',
	// One layout for every chain, packed to a landscape canvas instead of a
	// tall stack of frames.
	'elk.separateConnectedComponents': 'true',
	'elk.spacing.componentComponent': '64',
	'elk.aspectRatio': String(TARGET_ASPECT)
};

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

/** ELK occasionally emits a 1px drift on a segment meant to be axis-aligned. */
function snapOrthogonal(points: Pt[]): Pt[] {
	const out = points.map((p) => ({ ...p }));
	for (let i = 1; i < out.length - 1; i++) {
		const prev = out[i - 1];
		const cur = out[i];
		const dx = Math.abs(cur.x - prev.x);
		const dy = Math.abs(cur.y - prev.y);
		if (dx > 0.01 && dx < 1.5) cur.x = prev.x;
		else if (dy > 0.01 && dy < 1.5) cur.y = prev.y;
	}
	return dedupePoints(out);
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
	/** Bottom-edge fraction each edge leaves from (0.5 is the centre). */
	edgeSourcePort: Map<string, number>;
	/** Top-edge fraction each edge enters at (0.5 is the centre). */
	edgeTargetPort: Map<string, number>;
	frame: Rect;
}

interface PortSpec {
	id: string;
	x: number;
}

/**
 * A fan-in edge leaves ELK at the target centre. Move its final approach to a
 * distinct top port, using a horizontal lane just above the target row when the
 * direct vertical would pass through a card above the target.
 */
function approachTarget(
	points: Pt[],
	target: Rect,
	fraction: number,
	obstacles: Rect[]
): Pt[] | null {
	if (Math.abs(fraction - 0.5) < 0.001 || points.length < 3) return null;
	const last = points[points.length - 1];
	const penultimate = points[points.length - 2];
	if (Math.abs(penultimate.x - last.x) > 1.5) return null;
	const portX = target.x + target.w * fraction;
	const base = points.slice(0, -1);
	const lanes = [
		penultimate.y,
		target.y - 12,
		target.y - 20,
		target.y - 28,
		target.y - 36,
		target.y - 44
	];
	for (const lane of lanes) {
		if (lane >= target.y - 2) continue;
		const candidate = dedupePoints([
			...base,
			{ x: penultimate.x, y: lane },
			{ x: portX, y: lane },
			{ x: portX, y: target.y }
		]);
		if (candidate.length >= 2 && allClear(piecesOf(candidate), obstacles)) return candidate;
	}
	return null;
}

/**
 * Lay out every dependency chain in one ELK pass. `separateConnectedComponents`
 * lets ELK pack the chains against a landscape aspect ratio instead of stacking
 * them vertically, which is what keeps a 117-issue backlog from opening as a
 * tall strip.
 *
 * Fan-out edges get their own source port along the card's bottom edge. A first
 * pass establishes where the targets land, then each card's outgoing ports are
 * ordered left-to-right by target x so the fan does not cross itself. A single
 * outgoing edge keeps the bottom-centre port.
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
	const keyOf = (e: DepEdge): string => `${e.from}->${e.to}`;

	const outgoing = new Map<number, DepEdge[]>();
	for (const edge of chainEdges) {
		const list = outgoing.get(edge.from) ?? [];
		list.push(edge);
		outgoing.set(edge.from, list);
	}

	const buildGraph = (
		sourcePorts: Map<number, PortSpec[]>,
		edgePorts: Map<string, string>
	): ElkNode => ({
		id: 'root',
		layoutOptions: ELK_LAYOUT_OPTIONS,
		children: members.flatMap((n) => {
			const size = sizes.get(n);
			if (!size) return [];
			const ports = (sourcePorts.get(n) ?? []).map((port) => ({
				id: port.id,
				x: port.x,
				y: size.height,
				width: 1,
				height: 1,
				layoutOptions: { 'elk.port.side': 'SOUTH' }
			}));
			ports.push({
				id: `in-${n}`,
				x: size.width / 2,
				y: 0,
				width: 1,
				height: 1,
				layoutOptions: { 'elk.port.side': 'NORTH' }
			});
			return [
				{
					id: `issue-${n}`,
					width: size.width,
					height: size.height,
					layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
					ports
				}
			];
		}),
		edges: chainEdges.map((e) => ({
			id: `edge-${e.from}-${e.to}`,
			sources: [edgePorts.get(keyOf(e)) ?? `out-${e.from}`],
			targets: [`in-${e.to}`]
		}))
	});

	const elk = await getElk();

	// Pass one: one centre port per card, just to learn the target columns.
	const firstPorts = new Map<number, PortSpec[]>();
	const firstEdgePorts = new Map<string, string>();
	for (const n of members) {
		const size = sizes.get(n);
		if (!size) continue;
		firstPorts.set(n, [{ id: `out-${n}`, x: size.width / 2 }]);
	}
	for (const edge of chainEdges) firstEdgePorts.set(keyOf(edge), `out-${edge.from}`);
	const firstLaid = await elk.layout(buildGraph(firstPorts, firstEdgePorts));
	const firstPositions = new Map<number, Pt>();
	for (const child of firstLaid.children ?? []) {
		const n = Number(child.id.replace('issue-', ''));
		if (!Number.isFinite(n)) continue;
		firstPositions.set(n, { x: child.x ?? 0, y: child.y ?? 0 });
	}

	// Pass two: distribute each card's outgoing ports across its bottom edge.
	const sourcePorts = new Map<number, PortSpec[]>();
	const edgePorts = new Map<string, string>();
	const edgeSourcePort = new Map<string, number>();
	const hasFanOut = [...outgoing.values()].some((list) => list.length > 1);
	if (!hasFanOut) {
		for (const n of members) {
			const size = sizes.get(n);
			if (!size) continue;
			sourcePorts.set(n, [{ id: `out-${n}`, x: size.width / 2 }]);
		}
		for (const edge of chainEdges) {
			edgePorts.set(keyOf(edge), `out-${edge.from}`);
			edgeSourcePort.set(keyOf(edge), 0.5);
		}
	} else {
		for (const n of members) {
			const size = sizes.get(n);
			if (!size) continue;
			const list = outgoing.get(n) ?? [];
			if (list.length === 0) {
				sourcePorts.set(n, []);
				continue;
			}
			const sorted = list.slice().sort((a, b) => {
				const ax = firstPositions.get(a.to)?.x ?? 0;
				const bx = firstPositions.get(b.to)?.x ?? 0;
				return ax - bx || a.to - b.to;
			});
			const ports = sorted.map((edge, index) => {
				const fraction = (index + 1) / (sorted.length + 1);
				edgePorts.set(keyOf(edge), `out-${n}-${index}`);
				edgeSourcePort.set(keyOf(edge), fraction);
				return { id: `out-${n}-${index}`, x: size.width * fraction };
			});
			sourcePorts.set(n, ports);
		}
	}

	const laid = hasFanOut ? await elk.layout(buildGraph(sourcePorts, edgePorts)) : firstLaid;

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

	const componentEdges: DepEdge[][] = chains.map(() => []);
	for (const edge of chainEdges) {
		const component = componentOf.get(edge.from);
		if (component !== undefined) componentEdges[component].push(edge);
	}

	// ELK centres cards of different heights inside a layer. That reads as a
	// ragged row. Group by the row ELK actually placed a card in (vertical
	// centre), then top-align each row.
	chains.forEach((group) => {
		const rows: number[][] = [];
		const ordered = [...group].sort((a, b) => {
			const aPos = positions.get(a);
			const bPos = positions.get(b);
			const aSize = sizes.get(a);
			const bSize = sizes.get(b);
			const aCenter = (aPos?.y ?? 0) + (aSize?.height ?? 0) / 2;
			const bCenter = (bPos?.y ?? 0) + (bSize?.height ?? 0) / 2;
			return aCenter - bCenter;
		});
		for (const n of ordered) {
			const pos = positions.get(n);
			const size = sizes.get(n);
			if (!pos || !size) continue;
			const center = pos.y + size.height / 2;
			const row = rows[rows.length - 1];
			if (row) {
				const firstPos = positions.get(row[0]);
				const firstSize = sizes.get(row[0]);
				const firstCenter = (firstPos?.y ?? 0) + (firstSize?.height ?? 0) / 2;
				if (Math.abs(center - firstCenter) < 10) {
					row.push(n);
					continue;
				}
			}
			rows.push([n]);
		}
		for (const row of rows) {
			const top = Math.min(...row.map((n) => positions.get(n)?.y ?? 0));
			for (const n of row) {
				const pos = positions.get(n);
				if (!pos) continue;
				pos.y = top;
				const rect = rectById.get(n);
				if (rect) rect.y = top;
			}
		}
	});

	// Incoming edges keep ELK's single top port for layout, but each one gets
	// its own render-time entry point. Redistributing target ports inside ELK
	// destabilised component packing, so only the final approach is changed.
	const incoming = new Map<number, DepEdge[]>();
	for (const edge of chainEdges) {
		const list = incoming.get(edge.to) ?? [];
		list.push(edge);
		incoming.set(edge.to, list);
	}
	const edgeTargetPort = new Map<string, number>();
	for (const edge of chainEdges) edgeTargetPort.set(keyOf(edge), 0.5);
	for (const list of incoming.values()) {
		if (list.length < 2) continue;
		const sorted = list.slice().sort((a, b) => {
			const ax =
				(positions.get(a.from)?.x ?? 0) +
				(sizes.get(a.from)?.width ?? 0) * (edgeSourcePort.get(keyOf(a)) ?? 0.5);
			const bx =
				(positions.get(b.from)?.x ?? 0) +
				(sizes.get(b.from)?.width ?? 0) * (edgeSourcePort.get(keyOf(b)) ?? 0.5);
			return ax - bx || a.from - b.from;
		});
		sorted.forEach((edge, index) => {
			edgeTargetPort.set(keyOf(edge), (index + 1) / (sorted.length + 1));
		});
	}

	const edgePoints = chains.map(() => new Map<string, Pt[]>());
	for (const edge of laid.edges ?? []) {
		let points: Pt[] = [];
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
		const fromPos = positions.get(from);
		const fromSize = sizes.get(from);
		const toPos = positions.get(to);
		const toSize = sizes.get(to);
		if (!fromPos || !fromSize || !toPos || !toSize) continue;
		const fraction = edgeSourcePort.get(key) ?? 0.5;
		const start = { x: fromPos.x + fromSize.width * fraction, y: fromPos.y + fromSize.height };
		const end = { x: toPos.x + toSize.width / 2, y: toPos.y };
		points = snapOrthogonal(points);
		points[0] = start;
		points[points.length - 1] = end;
		if (points.length > 2 && Math.abs(points[1].x - start.x) < 2) {
			points[1].x = start.x;
			points[1].y = Math.max(points[1].y, start.y + 8);
		}
		if (points.length > 2 && Math.abs(points[points.length - 2].x - end.x) < 2) {
			const penultimate = points[points.length - 2];
			penultimate.x = end.x;
			penultimate.y = Math.min(penultimate.y, end.y - 8);
		}
		const obstacles = [...rectById.entries()]
			.filter(([id]) => id !== from && id !== to)
			.map(([, rect]) => rect);
		const repaired = avoidCards(points, obstacles);
		const targetRect = rectById.get(to);
		const targetFraction = edgeTargetPort.get(key) ?? 0.5;
		const adjusted = targetRect
			? approachTarget(repaired, targetRect, targetFraction, obstacles)
			: null;
		if (adjusted) {
			edgePoints[component].set(key, adjusted);
		} else {
			edgePoints[component].set(key, repaired);
			if (targetFraction !== 0.5) edgeTargetPort.set(key, 0.5);
		}
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
			edgeSourcePort,
			edgeTargetPort,
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

	const chainLayouts = await layoutChains(chains, boardEdges, sizes);

	const frames: FrameLayout[] = chainLayouts.map((layout, index) => ({
		id: `chain-${index}`,
		label: `Chain · ${layout.members.length} issues`,
		count: layout.members.length,
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
	const chainFrames = frames.filter((frame) => frame.id !== 'chain-independent');
	const independentFrame = frames.find((frame) => frame.id === 'chain-independent');
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
			data: { label: frame.label, count: frame.count },
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
			const blocked = dataByNumber.get(edge.to);
			const blocking = !!blocked && blocked.issue.state === 'open' && blocked.openBlockers > 0;
			const color = blocking ? '#ef4444' : '#a3a3a3';
			edges.push({
				id: `edge-${edge.from}-${edge.to}`,
				source: `issue-${edge.from}`,
				target: `issue-${edge.to}`,
				type: 'rounded',
				data: {
					points: points.map((p) => ({
						x: p.x - offsetX + chainShiftX,
						y: p.y - offsetY
					})),
					sourcePort: layout.edgeSourcePort.get(`${edge.from}->${edge.to}`) ?? 0.5,
					targetPort: layout.edgeTargetPort.get(`${edge.from}->${edge.to}`) ?? 0.5
				},
				markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
				style: `stroke: ${color}; stroke-width: 1.5;`
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
