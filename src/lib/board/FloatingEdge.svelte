<script lang="ts">
	import { BaseEdge, getBezierPath, useInternalNode } from '@xyflow/svelte';
	import type { EdgeProps } from '@xyflow/svelte';
	import { getEdgeParams } from './floating-edge-utils';

	let { source, target, markerEnd, style }: EdgeProps = $props();

	const sourceNode = useInternalNode(() => ({ id: source }));
	const targetNode = useInternalNode(() => ({ id: target }));

	let path = $derived.by(() => {
		const s = sourceNode.current;
		const t = targetNode.current;
		if (!s || !t) return '';
		const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(s, t);
		return getBezierPath({
			sourceX: sx,
			sourceY: sy,
			sourcePosition: sourcePos,
			targetX: tx,
			targetY: ty,
			targetPosition: targetPos
		})[0];
	});
</script>

{#if path}
	<BaseEdge {path} {markerEnd} {style} />
{/if}
