<script lang="ts">
	import { BaseEdge, useInternalNode } from '@xyflow/svelte';
	import type { EdgeProps } from '@xyflow/svelte';

	type Pt = { x: number; y: number };
	const RADIUS = 7;

	let { source, target, data, markerEnd, style }: EdgeProps = $props();

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
		const s = sourceNode.current;
		const t = targetNode.current;
		const seedData = data as { points?: Pt[]; sourcePort?: number } | undefined;
		const sourcePort = seedData?.sourcePort ?? 0.5;
		const seeded: Pt[] = seedData?.points ?? [];
		if (!s || !t || seeded.length < 2) return '';
		const sx = s.internals.positionAbsolute.x + (s.measured.width ?? 0) * sourcePort;
		const sy = s.internals.positionAbsolute.y + (s.measured.height ?? 0);
		const tx = t.internals.positionAbsolute.x + (t.measured.width ?? 0) / 2;
		const ty = t.internals.positionAbsolute.y;
		const dx = sx - seeded[0].x;
		const dy = sy - seeded[0].y;
		const points: Pt[] = seeded.map((p) => ({ x: p.x + dx, y: p.y + dy }));
		points[0] = { x: sx, y: sy };
		const last = points[points.length - 1];
		const penultimate = points[points.length - 2];
		// ELK routes into the target's NORTH port, so the final leg is vertical:
		// stretch/shrink it to land on the measured top-center.
		if (points.length > 2 && Math.abs(penultimate.x - last.x) <= 1) {
			penultimate.x = tx;
			last.x = tx;
			last.y = ty;
		} else {
			// Defensive: keep the translated route and append an orthogonal re-anchor.
			const midY = (last.y + ty) / 2;
			points.push({ x: last.x, y: midY }, { x: tx, y: midY }, { x: tx, y: ty });
		}
		return roundedPath(points);
	});
</script>

{#if path}
	<BaseEdge {path} {markerEnd} {style} />
{/if}
