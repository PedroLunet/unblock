<script lang="ts">
	import '@xyflow/svelte/dist/base.css';
	import {
		Background,
		BackgroundVariant,
		Controls,
		MarkerType,
		SvelteFlow,
		useSvelteFlow
	} from '@xyflow/svelte';
	import type { Edge } from '@xyflow/svelte';
	import ChainFrame from './ChainFrame.svelte';
	import IssueNode from './IssueNode.svelte';
	import OrthogonalEdge from './OrthogonalEdge.svelte';
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
	const edgeTypes = { orthogonal: OrthogonalEdge };

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
					style: 'stroke: #991b1b; stroke-width: 2.5;',
					markerEnd: {
						type: MarkerType.ArrowClosed,
						width: 16,
						height: 16,
						color: '#991b1b'
					}
				};
			}
			return { ...edge, style: `${edge.style ?? ''} opacity: 0.25;` };
		});
	});

	export function fitView(): void {
		requestAnimationFrame(() => {
			void flow.fitView({ padding: 0.15, duration: 200 });
		});
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
		panOnScroll={true}
		panOnScrollSpeed={0.6}
		zoomOnPinch={true}
		zoomOnDoubleClick={false}
		onlyRenderVisibleElements
		fitView
		fitViewOptions={{ padding: 0.15 }}
		onnodeclick={handleNodeClick}
		{onpaneclick}
	>
		<Controls position="bottom-left" showZoom showFitView showLock={false} />
		<Background variant={BackgroundVariant.Dots} gap={18} size={1.6} patternColor="#c7c7c7" />
	</SvelteFlow>
</div>
