<script lang="ts">
	import {
		Background,
		BackgroundVariant,
		MarkerType,
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
					style: 'stroke: #3a5cf0; stroke-width: 2;',
					markerEnd: {
						type: MarkerType.ArrowClosed,
						width: 14,
						height: 14,
						color: '#3a5cf0'
					}
				};
			}
			return { ...edge, style: `${edge.style ?? ''} opacity: 0.2;` };
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
		maxZoom={2}
		nodesConnectable={false}
		panOnScroll={true}
		panOnScrollSpeed={0.6}
		zoomOnPinch={true}
		zoomOnDoubleClick={false}
		onlyRenderVisibleElements
		fitView
		fitViewOptions={{ padding: 0.12 }}
		forceColorMode="light"
		onnodeclick={handleNodeClick}
		{onpaneclick}
	>
		<Background variant={BackgroundVariant.Dots} gap={24} size={1.2} patternColor="#d4dae2" />
	</SvelteFlow>
</div>
