<script lang="ts">
	import { BaseEdge, useInternalNode } from '@xyflow/svelte';
	import type { EdgeProps } from '@xyflow/svelte';
	import type { RoundedEdgeData } from './graph';

	type Pt = { x: number; y: number };
	const RADIUS = 7;

	let { source, target, data, markerEnd, style }: EdgeProps = $props();

	// The routed polyline is seeded by ELK. Follow node drags by shifting the
	// whole route with its source node instead of leaving it at build coords.
	const sourceNode = useInternalNode(() => ({ id: source }));
	const targetNode = useInternalNode(() => ({ id: target }));

	function roundedPath(rawPoints: Pt[]): string {
		const points = rawPoints.filter((p, i) => {
			if (i === 0) return true;
			const prev = rawPoints[i - 1];
			return Math.hypot(p.x - prev.x, p.y - prev.y) > 0.5;
		});
		if (points.length < 2) return '';
		const parts = [`M ${points[0].x} ${points[0].y}`];
		for (let i = 1; i < points.length - 1; i++) {
			const prev = points[i - 1];
			const cur = points[i];
			const next = points[i + 1];
			const lenPrev = Math.hypot(cur.x - prev.x, cur.y - prev.y);
			const lenNext = Math.hypot(next.x - cur.x, next.y - cur.y);
			if (lenPrev === 0 || lenNext === 0) continue;
			const r = Math.min(RADIUS, lenPrev / 2, lenNext / 2);
			const ax = cur.x + ((prev.x - cur.x) / lenPrev) * r;
			const ay = cur.y + ((prev.y - cur.y) / lenPrev) * r;
			const bx = cur.x + ((next.x - cur.x) / lenNext) * r;
			const by = cur.y + ((next.y - cur.y) / lenNext) * r;
			parts.push(`L ${ax} ${ay}`, `Q ${cur.x} ${cur.y} ${bx} ${by}`);
		}
		const last = points[points.length - 1];
		parts.push(`L ${last.x} ${last.y}`);
		return parts.join(' ');
	}

	const path = $derived.by(() => {
		const edgeData = data as RoundedEdgeData | undefined;
		const seeded = edgeData?.points ?? [];
		if (seeded.length < 2) return '';

		const origin = edgeData?.origin;
		const currentSource = sourceNode.current?.internals.positionAbsolute;
		const currentTarget = targetNode.current?.internals.positionAbsolute;
		let offsetX = 0;
		let offsetY = 0;
		if (origin && currentSource) {
			offsetX = currentSource.x - origin.source.x;
			offsetY = currentSource.y - origin.source.y;
		} else if (origin && currentTarget) {
			offsetX = currentTarget.x - origin.target.x;
			offsetY = currentTarget.y - origin.target.y;
		}
		if (offsetX === 0 && offsetY === 0) return roundedPath(seeded);
		return roundedPath(seeded.map((p) => ({ x: p.x + offsetX, y: p.y + offsetY })));
	});
</script>

{#if path}
	<BaseEdge {path} {markerEnd} {style} />
{/if}
