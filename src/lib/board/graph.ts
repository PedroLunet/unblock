import type { ElkNode } from 'elkjs/lib/elk-api';
import { MarkerType } from '@xyflow/svelte';
import type { Edge, Node } from '@xyflow/svelte';
import { resolveRef } from '#lib/github';
import type { DepEdge, IssueRecord, RepoData } from '#lib/github';
import { CARD_WIDTH, cardRows, estimateCardHeight } from './card-metrics';
import { FRAME_HEADER_HEIGHT } from './frame-metrics';

const FRAME_PAD = 20;
const BLOCK_GAP = 72;
const INDEP_GAP = 24;

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
	'elk.spacing.componentComponent': '76',
	'elk.aspectRatio': String(TARGET_ASPECT)
};

interface Pt {
	x: number;
	y: number;
}

export interface RoundedEdgeData {
	points: Pt[];
	/** Node top-left positions when the route was seeded — used to follow drags. */
	origin: { source: Pt; target: Pt };
	[key: string]: unknown;
}

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
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
 * Lay out every dependency chain in one ELK pass. ELK owns placement, port
 * assignment and orthogonal routing — the same model issues-graph uses. No
 * fixed ports, no post-layout node movement and no custom edge repair: the
 * router's own edgeNode/edgeEdge spacing is what keeps arrows apart.
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
			return [{ id: `issue-${n}`, width: size.width, height: size.height }];
		}),
		edges: chainEdges.map((e) => ({
			id: `edge-${e.from}-${e.to}`,
			sources: [`issue-${e.from}`],
			targets: [`issue-${e.to}`]
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

	const edgePoints = chains.map(() => new Map<string, Pt[]>());
	for (const edge of laid.edges ?? []) {
		const section = edge.sections?.[0];
		if (!section) continue;
		const points = [
			{ x: section.startPoint.x, y: section.startPoint.y },
			...(section.bendPoints ?? []).map((bend) => ({ x: bend.x, y: bend.y })),
			{ x: section.endPoint.x, y: section.endPoint.y }
		];
		const key = edge.id.replace(/^edge-/, '').replace('-', '->');
		const from = Number(key.split('->')[0]);
		const component = componentOf.get(from);
		if (component !== undefined) edgePoints[component].set(key, points);
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
		return {
			members: group,
			positions,
			edgePoints: edgePoints[component],
			frame: {
				x: minX - FRAME_PAD,
				y: minY - FRAME_PAD - FRAME_HEADER_HEIGHT,
				w: maxX - minX + FRAME_PAD * 2,
				h: maxY - minY + FRAME_PAD * 2 + FRAME_HEADER_HEIGHT
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
		sizes.set(issue.number, {
			width: CARD_WIDTH,
			height: estimateCardHeight(cardRows(issue))
		});
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
			y: blockY - FRAME_PAD - FRAME_HEADER_HEIGHT,
			w: contentWidth + FRAME_PAD * 2,
			h: contentHeight + FRAME_PAD * 2 + FRAME_HEADER_HEIGHT,
			children: best.placed.map((p) => ({
				n: p.n,
				x: p.x + FRAME_PAD,
				y: p.y + FRAME_PAD + FRAME_HEADER_HEIGHT
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

	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const absolutePosition = (id: string): Pt => {
		const node = nodeById.get(id);
		if (!node) return { x: 0, y: 0 };
		const parent = node.parentId ? nodeById.get(node.parentId) : undefined;
		return {
			x: (parent?.position.x ?? 0) + node.position.x,
			y: (parent?.position.y ?? 0) + node.position.y
		};
	};

	const edges: Edge[] = [];
	chainLayouts.forEach((layout) => {
		const members = new Set(layout.members);
		for (const edge of boardEdges) {
			if (!members.has(edge.from) || !members.has(edge.to)) continue;
			const rawPoints = layout.edgePoints.get(`${edge.from}->${edge.to}`);
			if (!rawPoints) continue;
			const points = rawPoints.map((p) => ({
				x: p.x - offsetX + chainShiftX,
				y: p.y - offsetY
			}));
			const color = '#b7aea4';
			edges.push({
				id: `edge-${edge.from}-${edge.to}`,
				source: `issue-${edge.from}`,
				target: `issue-${edge.to}`,
				type: 'rounded',
				data: {
					points,
					origin: {
						source: absolutePosition(`issue-${edge.from}`),
						target: absolutePosition(`issue-${edge.to}`)
					}
				} satisfies RoundedEdgeData,
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
