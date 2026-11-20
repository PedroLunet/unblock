<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import type { FrameNode } from './graph';

	let { data }: NodeProps<FrameNode> = $props();
</script>

<div
	class="h-full w-full overflow-hidden rounded-md border border-dashed border-neutral-300 bg-neutral-50/60"
>
	<div
		class="border-b border-dashed border-neutral-300 px-2.5 py-1 text-[11px] font-medium tracking-wide text-neutral-500 uppercase"
	>
		{data.label}
	</div>
</div>
