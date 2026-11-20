import dagre from '@dagrejs/dagre';
import { MarkerType } from '@xyflow/svelte';
import type { Edge, Node } from '@xyflow/svelte';
import { resolveRef } from '#lib/github';
import type { DepEdge, IssueRecord, RepoData } from '#lib/github';

/** Fixed card geometry — the node CSS must match these sizes exactly so dagre positions stay truthful. */
export const CARD_WIDTH = 240;
export const CARD_HEIGHT = 170;

const FRAME_HEADER = 30;
const FRAME_PAD = 20;
const CHAIN_GAP = 48;
const CHAIN_NODESEP = 40;
const CHAIN_RANKSEP = 72;
const INDEP_GAP = 24;
const INDEP_MAX_COLS = 6;

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

function layoutChain(
	members: number[],
	edges: DepEdge[],
	issuesByNumber: Map<number, IssueRecord>
): Map<number, { x: number; y: number }> {
	const graph = new dagre.graphlib.Graph();
	graph.setGraph({
		rankdir: 'TB',
		nodesep: CHAIN_NODESEP,
		ranksep: CHAIN_RANKSEP,
		marginx: 0,
		marginy: 0
	});
	graph.setDefaultEdgeLabel(() => ({}));
	for (const n of members) {
		graph.setNode(String(n), { width: CARD_WIDTH, height: CARD_HEIGHT });
	}
	for (const edge of edges) {
		if (members.includes(edge.from) && members.includes(edge.to)) {
			graph.setEdge(String(edge.from), String(edge.to));
		}
	}
	dagre.layout(graph);

	let minX = Infinity;
	let minY = Infinity;
	for (const n of members) {
		const pos = graph.node(String(n)) as { x: number; y: number } | undefined;
		if (!pos || !issuesByNumber.has(n)) continue;
		minX = Math.min(minX, pos.x - CARD_WIDTH / 2);
		minY = Math.min(minY, pos.y - CARD_HEIGHT / 2);
	}
	if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
		minX = 0;
		minY = 0;
	}
	const positions = new Map<number, { x: number; y: number }>();
	for (const n of members) {
		const pos = graph.node(String(n)) as { x: number; y: number } | undefined;
		if (!pos) continue;
		positions.set(n, { x: pos.x - CARD_WIDTH / 2 - minX, y: pos.y - CARD_HEIGHT / 2 - minY });
	}
	return positions;
}

/**
 * Build Svelte Flow nodes and edges for the current data + view filters.
 * Dependency chains are dagre-laid-out top-to-bottom and wrapped in labeled
 * frame nodes; singleton issues are packed into one "Independent" frame.
 */
export function buildBoard(data: RepoData, filters: BoardFilters): BoardModel {
	const visible = data.issues.filter((issue) => passesFilters(issue, filters));
	const visibleSet = new Set(visible.map((issue) => issue.number));
	const issuesByNumber = new Map(visible.map((issue) => [issue.number, issue]));
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
	const chains = components.filter((group) => group.length > 1);
	const singles = components.filter((group) => group.length === 1).map((group) => group[0]);

	const nodes: BoardNode[] = [];
	let yCursor = 0;
	let chainIndex = 0;

	for (const chain of chains) {
		const positions = layoutChain(chain, boardEdges, issuesByNumber);
		let maxX = 0;
		let maxY = 0;
		for (const pos of positions.values()) {
			maxX = Math.max(maxX, pos.x + CARD_WIDTH);
			maxY = Math.max(maxY, pos.y + CARD_HEIGHT);
		}
		const frameId = `chain-${chainIndex}`;
		nodes.push({
			id: frameId,
			type: 'frame',
			position: { x: 0, y: yCursor },
			style: `width:${maxX + FRAME_PAD * 2}px;height:${maxY + FRAME_PAD * 2 + FRAME_HEADER}px`,
			data: { label: `Chain · ${chain.length} issues`, count: chain.length },
			draggable: true,
			selectable: false
		});
		for (const n of chain) {
			const issue = issuesByNumber.get(n);
			const pos = positions.get(n);
			if (!issue || !pos) continue;
			nodes.push({
				id: `issue-${n}`,
				type: 'issue',
				parentId: frameId,
				extent: 'parent',
				position: { x: pos.x + FRAME_PAD, y: pos.y + FRAME_PAD + FRAME_HEADER },
				data: issueData(issue)
			});
		}
		yCursor += maxY + FRAME_PAD * 2 + FRAME_HEADER + CHAIN_GAP;
		chainIndex++;
	}

	if (singles.length > 0) {
		const cols = Math.min(INDEP_MAX_COLS, Math.max(2, Math.ceil(Math.sqrt(singles.length))));
		const rows = Math.ceil(singles.length / cols);
		const frameId = 'chain-independent';
		const frameWidth = cols * CARD_WIDTH + (cols - 1) * INDEP_GAP + FRAME_PAD * 2;
		const frameHeight = rows * CARD_HEIGHT + (rows - 1) * INDEP_GAP + FRAME_PAD * 2 + FRAME_HEADER;
		nodes.push({
			id: frameId,
			type: 'frame',
			position: { x: 0, y: yCursor },
			style: `width:${frameWidth}px;height:${frameHeight}px`,
			data: { label: `Independent · ${singles.length} issues`, count: singles.length },
			draggable: true,
			selectable: false
		});
		singles.forEach((n, i) => {
			const issue = issuesByNumber.get(n);
			if (!issue) return;
			const col = i % cols;
			const row = Math.floor(i / cols);
			nodes.push({
				id: `issue-${n}`,
				type: 'issue',
				parentId: frameId,
				extent: 'parent',
				position: {
					x: FRAME_PAD + col * (CARD_WIDTH + INDEP_GAP),
					y: FRAME_HEADER + FRAME_PAD + row * (CARD_HEIGHT + INDEP_GAP)
				},
				data: issueData(issue)
			});
		});
	}

	const edges: Edge[] = boardEdges.map((edge) => ({
		id: `edge-${edge.from}-${edge.to}`,
		source: `issue-${edge.from}`,
		target: `issue-${edge.to}`,
		type: 'smoothstep',
		markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#a3a3a3' },
		style: 'stroke: #a3a3a3; stroke-width: 1.5;'
	}));

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
