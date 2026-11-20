<script lang="ts">
	import { BaseEdge } from '@xyflow/svelte';
	import type { EdgeProps } from '@xyflow/svelte';

	type Point = { x: number; y: number };

	let { sourceX, sourceY, targetX, targetY, data, markerEnd, style }: EdgeProps = $props();

	function collapse(points: Point[]): Point[] {
		const result: Point[] = [];
		for (const point of points) {
			const previous = result[result.length - 1];
			if (
				previous &&
				Math.abs(previous.x - point.x) < 0.5 &&
				Math.abs(previous.y - point.y) < 0.5
			) {
				continue;
			}
			result.push(point);
		}
		return result;
	}

	function liveRoute(sx: number, sy: number, tx: number, ty: number): Point[] {
		const stub = Math.max(8, Math.min(24, (ty - sy) * 0.4));
		return [
			{ x: sx, y: sy },
			{ x: sx, y: sy + stub },
			{ x: tx, y: sy + stub },
			{ x: tx, y: ty }
		];
	}

	function round1(value: number): number {
		return Math.round(value * 10) / 10;
	}

	let path = $derived.by(() => {
		const seeded = (data as { points?: Point[] } | undefined)?.points ?? [];
		let rendered: Point[];

		if (seeded.length >= 2) {
			const first = seeded[0];
			const last = seeded[seeded.length - 1];
			const dsx = sourceX - first.x;
			const dsy = sourceY - first.y;
			const dtx = targetX - last.x;
			const dty = targetY - last.y;

			if (Math.abs(dsx - dtx) < 1.5 && Math.abs(dsy - dty) < 1.5) {
				rendered = seeded.map((point) => ({ x: point.x + dsx, y: point.y + dsy }));
			} else {
				rendered = collapse(liveRoute(sourceX, sourceY, targetX, targetY));
			}
		} else {
			rendered = collapse(liveRoute(sourceX, sourceY, targetX, targetY));
		}

		if (rendered.length < 2) return '';
		return rendered
			.map((point, index) => `${index === 0 ? 'M' : 'L'} ${round1(point.x)} ${round1(point.y)}`)
			.join(' ');
	});
</script>

{#if path}
	<BaseEdge {path} {markerEnd} {style} />
{/if}
