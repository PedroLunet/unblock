<script lang="ts">
	import '@xyflow/svelte/dist/base.css';
	import {
		Background,
		BackgroundVariant,
		Controls,
		SvelteFlow,
		useSvelteFlow
	} from '@xyflow/svelte';
	import type { Edge } from '@xyflow/svelte';
	import ChainFrame from './ChainFrame.svelte';
	import IssueNode from './IssueNode.svelte';
	import type { BoardNode } from './graph';

	interface Props {
		nodes: BoardNode[];
		edges: Edge[];
		onissueclick: (issueNumber: number) => void;
		onpaneclick: () => void;
	}

	let { nodes = $bindable(), edges = $bindable(), onissueclick, onpaneclick }: Props = $props();

	const nodeTypes = { issue: IssueNode, frame: ChainFrame };

	const flow = useSvelteFlow();

	export function fitView(): void {
		requestAnimationFrame(() => {
			void flow.fitView({ padding: 0.15 });
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
		bind:edges
		{nodeTypes}
		minZoom={0.1}
		maxZoom={1.5}
		nodesConnectable={false}
		onlyRenderVisibleElements
		fitView
		fitViewOptions={{ padding: 0.15 }}
		onnodeclick={handleNodeClick}
		{onpaneclick}
	>
		<Controls position="bottom-left" showZoom showFitView showLock={false} />
		<Background variant={BackgroundVariant.Dots} gap={18} patternColor="#c7c7c7" />
	</SvelteFlow>
</div>
