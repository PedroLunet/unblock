<script lang="ts">
	import { BaseEdge } from '@xyflow/svelte';
	import type { EdgeProps } from '@xyflow/svelte';

	type Pt = { x: number; y: number };
	const RADIUS = 7;

	let { sourceX, sourceY, targetX, targetY, data, markerEnd, style }: EdgeProps = $props();

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
		const seeded: Pt[] = (data as { points?: Pt[] } | undefined)?.points ?? [];
		if (seeded.length >= 2) {
			const first = seeded[0];
			const last = seeded[seeded.length - 1];
			const dx = sourceX - first.x;
			const dy = sourceY - first.y;
			const tdx = targetX - last.x;
			const tdy = targetY - last.y;
			if (Math.abs(dx - tdx) < 1.5 && Math.abs(dy - tdy) < 1.5) {
				return roundedPath(seeded.map((p) => ({ x: p.x + dx, y: p.y + dy })));
			}
		}
		// While a single node is dragged: still bottom->top, orthogonal, shared stub.
		const stub = Math.max(10, Math.min(24, (targetY - sourceY) * 0.3));
		return roundedPath([
			{ x: sourceX, y: sourceY },
			{ x: sourceX, y: sourceY + stub },
			{ x: targetX, y: sourceY + stub },
			{ x: targetX, y: targetY }
		]);
	});
</script>

{#if path}
	<BaseEdge {path} {markerEnd} {style} />
{/if}
