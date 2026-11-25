<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { NodeProps } from '@xyflow/svelte';
	import IssueCard from './IssueCard.svelte';
	import type { IssueNode as IssueNodeType } from './graph';

	let { data, selected }: NodeProps<IssueNodeType> = $props();
</script>

<div class="relative h-full w-full">
	<!-- Svelte Flow drops edges whose nodes have no handle bounds; these are invisible and unused by the routed geometry. -->
	<Handle type="target" position={Position.Top} style="opacity: 0; pointer-events: none;" />
	<Handle type="source" position={Position.Bottom} style="opacity: 0; pointer-events: none;" />

	<IssueCard
		issue={data.issue}
		openBlockers={data.openBlockers}
		resolvedBlockers={data.resolvedBlockers}
		iteration={data.iteration}
		iterationCount={data.iterationCount}
		showIteration={data.showIteration}
		{selected}
	/>
</div>
