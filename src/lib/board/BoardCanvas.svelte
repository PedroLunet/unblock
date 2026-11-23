<script lang="ts">
	import {
		Background,
		BackgroundVariant,
		Controls,
		MarkerType,
		MiniMap,
		Panel,
		SvelteFlow,
		useSvelteFlow
	} from '@xyflow/svelte';
	import type { Edge } from '@xyflow/svelte';
	import ChainFrame from './ChainFrame.svelte';
	import IssueNode from './IssueNode.svelte';
	import RoundedEdge from './RoundedEdge.svelte';
	import type { BoardNode } from './graph';

	interface Props {
		nodes: BoardNode[];
		edges: Edge[];
		highlightNodeId?: number | null;
		onissueclick: (issueNumber: number) => void;
		onpaneclick: () => void;
	}

	let {
		nodes = $bindable(),
		edges = $bindable(),
		highlightNodeId = null,
		onissueclick,
		onpaneclick
	}: Props = $props();

	const nodeTypes = { issue: IssueNode, frame: ChainFrame };
	const edgeTypes = { rounded: RoundedEdge };

	const flow = useSvelteFlow();

	let displayEdges = $derived.by(() => {
		const highlighted = highlightNodeId;
		if (highlighted === null) return edges;
		const nodeId = `issue-${highlighted}`;
		return edges.map((edge): Edge => {
			const connected = edge.source === nodeId || edge.target === nodeId;
			if (connected) {
				return {
					...edge,
					style: 'stroke: #1d1d1d; stroke-width: 2;',
					markerEnd: {
						type: MarkerType.ArrowClosed,
						width: 16,
						height: 16,
						color: '#1d1d1d'
					}
				};
			}
			return { ...edge, style: `${edge.style ?? ''} opacity: 0.25;` };
		});
	});

	export function fitView(): void {
		const fit = () => void flow.fitView({ padding: 0.18, duration: 200 });
		requestAnimationFrame(() => requestAnimationFrame(fit));
		// A second, instant fit once Svelte Flow has measured the rebuilt nodes.
		setTimeout(() => void flow.fitView({ padding: 0.18, duration: 0 }), 180);
	}

	function handleNodeClick(event: { node: BoardNode }): void {
		const node = event.node;
		if (node.type !== 'issue') return;
		const match = /^issue-(\d+)$/.exec(node.id);
		if (match) onissueclick(Number(match[1]));
	}
</script>

<div class="h-full w-full">
	<SvelteFlow
		bind:nodes
		edges={displayEdges}
		{nodeTypes}
		{edgeTypes}
		minZoom={0.1}
		maxZoom={1.5}
		nodesConnectable={false}
		nodesDraggable={false}
		panOnScroll={true}
		panOnScrollSpeed={0.6}
		zoomOnPinch={true}
		zoomOnDoubleClick={false}
		onlyRenderVisibleElements
		fitView
		fitViewOptions={{ padding: 0.18 }}
		forceColorMode="light"
		onnodeclick={handleNodeClick}
		{onpaneclick}
	>
		<Panel position="top-left">
			<div
				class="flex items-center gap-2 rounded-full border border-warm bg-paper/90 px-3 py-1.5 font-mono text-[9px] font-medium tracking-[0.1em] text-muted uppercase shadow-sm backdrop-blur"
			>
				<span class="h-[2px] w-5 rounded-full bg-[#b7aea4]"></span> blocks
			</div>
		</Panel>
		<Controls position="bottom-left" showZoom showFitView showLock={false} />
		<MiniMap position="bottom-right" pannable zoomable nodeStrokeWidth={0} />
		<Background variant={BackgroundVariant.Dots} gap={20} size={1} patternColor="#ddd4c9" />
	</SvelteFlow>
</div>
