<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import { FRAME_HEADER_HEIGHT } from './frame-metrics';
	import type { FrameNode } from './graph';

	let { data }: NodeProps<FrameNode> = $props();
</script>

<div class="h-full w-full overflow-hidden rounded-2xl border border-warm bg-paper/40">
	<div class="flex items-center gap-2.5 px-4" style={`height: ${FRAME_HEADER_HEIGHT}px`}>
		<span class="h-1.5 w-1.5 rounded-[2px] bg-brand" aria-hidden="true"></span>
		<span class="font-mono text-[9px] font-medium tracking-[0.1em] text-quiet uppercase">
			{data.label}
		</span>
	</div>
</div>
