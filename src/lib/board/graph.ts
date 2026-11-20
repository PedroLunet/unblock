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
	/** Task-list references that point at PRs, not issues. Rendered as muted chips, no edge. */
	prRefs: number[];
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

function hasBadgeRow(flow: Pick<IssueFlowData, 'resolvedBlockers' | 'prRefs' | 'issue'>): boolean {
	return flow.resolvedBlockers > 0 || flow.prRefs.length > 0 || flow.issue.linkedPRs.length > 0;
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
	const estimated = CARD_PAD + contentHeight + (rows - 1) * ROW_GAP;
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
	width: number;
	height: number;
}

const ELK_LAYOUT_OPTIONS: Record<string, string> = {
	'elk.algorithm': 'layered',
	'elk.direction': 'DOWN',
	'elk.edgeRouting': 'ORTHOGONAL',
	'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
	'elk.spacing.nodeNode': '56',
	'elk.layered.spacing.nodeNodeBetweenLayers': '88'
};

/**
 * ELK is heavy (~1.4 MB min) — load it lazily so the board shell paints while
 * the GitHub fetch and this chunk download in parallel.
 */ type ElkInstance = { layout: (graph: ElkNode) => Promise<ElkNode> };
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
			return size ? [{ id: `issue-${n}`, width: size.width, height: size.height }] : [];
		}),
		edges: componentEdges.map((e) => ({
			id: `edge-${e.from}-${e.to}`,
			sources: [`issue-${e.from}`],
			targets: [`issue-${e.to}`]
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
	return { positions, width: maxX, height: maxY };
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
		const prRefs: number[] = [];
		for (const ref of issue.blockedBy) {
			const target = resolveRef(data, ref.number);
			if (target.kind === 'pr') {
				prRefs.push(ref.number);
			} else if (target.kind === 'issue') {
				if (target.issue.state === 'open') openBlockers++;
				else if (!visibleSet.has(target.issue.number)) resolvedBlockers++;
			}
		}
		return {
			issue,
			openBlockers,
			resolvedBlockers,
			prRefs,
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
			const blocked = dataByNumber.get(edge.to);
			const blocking = !!blocked && blocked.issue.state === 'open' && blocked.openBlockers > 0;
			const color = blocking ? '#ef4444' : '#a3a3a3';
			edges.push({
				id: `edge-${edge.from}-${edge.to}`,
				source: `issue-${edge.from}`,
				target: `issue-${edge.to}`,
				type: 'floating',
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
