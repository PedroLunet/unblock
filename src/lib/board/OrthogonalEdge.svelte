<script lang="ts">
	import { BaseEdge } from '@xyflow/svelte';
	import type { EdgeProps } from '@xyflow/svelte';

	let { data, markerEnd, style }: EdgeProps = $props();
	const points = $derived(
		(data as { points?: { x: number; y: number }[] } | undefined)?.points ?? []
	);
	const path = $derived(
		points.length >= 2 ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') : ''
	);
</script>

{#if path}
	<BaseEdge {path} {markerEnd} {style} />
{/if}
