<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import type { FrameNode } from './graph';

	let { data }: NodeProps<FrameNode> = $props();

	const KIND_FRAME: Record<FrameNode['data']['kind'], string> = {
		chain: 'border-[#c4d0e4] bg-[#e9eff7]',
		independent: 'border-dashed border-line-strong bg-transparent'
	};
	const KIND_LABEL: Record<FrameNode['data']['kind'], string> = {
		chain: 'text-[#4a6a9b]',
		independent: 'text-quiet'
	};
</script>

<div
	class="h-full w-full cursor-grab overflow-hidden rounded-[14px] border-[1.5px] {KIND_FRAME[
		data.kind
	]}"
>
	<div
		class="flex h-[26px] items-center px-3 text-[11px] font-semibold tracking-[-0.01em] {KIND_LABEL[
			data.kind
		]}"
	>
		{data.label}
	</div>
</div>
