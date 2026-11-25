import type { IterationInfo } from './types';

const DAY_MS = 86_400_000;

const dayFormatter = new Intl.DateTimeFormat(undefined, {
	month: 'short',
	day: 'numeric',
	timeZone: 'UTC'
});

export type IterationStatus = 'upcoming' | 'active' | 'past';

/**
 * Identity for a sprint across projects. Two projects that schedule the same
 * title over the same days are treated as one iteration; a differently dated
 * "Iteration 2" stays distinct.
 */
export function iterationKey(iteration: IterationInfo): string {
	return JSON.stringify([iteration.title, iteration.startDate, iteration.duration]);
}

export function uniqueIterations(iterations: readonly IterationInfo[]): IterationInfo[] {
	const seen = new Set<string>();
	const out: IterationInfo[] = [];
	for (const iteration of iterations) {
		const key = iterationKey(iteration);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(iteration);
	}
	return out;
}

function startMs(iteration: IterationInfo): number {
	return Date.parse(`${iteration.startDate}T00:00:00Z`);
}

function durationMs(iteration: IterationInfo): number {
	return Math.max(1, iteration.duration) * DAY_MS;
}

export function iterationStatus(iteration: IterationInfo, now = Date.now()): IterationStatus {
	const start = startMs(iteration);
	if (!Number.isFinite(start)) return 'past';
	if (now < start) return 'upcoming';
	if (now >= start + durationMs(iteration)) return 'past';
	return 'active';
}

export function iterationStatusLabel(iteration: IterationInfo, now = Date.now()): string {
	const status = iterationStatus(iteration, now);
	return status === 'active' ? 'active' : status === 'upcoming' ? 'upcoming' : 'past';
}

/**
 * Pick the iteration a card should show when an issue belongs to several
 * projects: the current one first, then the next scheduled, then the latest
 * finished one.
 */
export function primaryIteration(
	iterations: readonly IterationInfo[],
	now = Date.now()
): IterationInfo | null {
	const unique = uniqueIterations(iterations);
	if (unique.length === 0) return null;

	const active = unique
		.filter((iteration) => iterationStatus(iteration, now) === 'active')
		.sort((a, b) => b.startDate.localeCompare(a.startDate));
	if (active.length > 0) return active[0];

	const upcoming = unique
		.filter((iteration) => iterationStatus(iteration, now) === 'upcoming')
		.sort((a, b) => a.startDate.localeCompare(b.startDate));
	if (upcoming.length > 0) return upcoming[0];

	return unique.sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
}

/** Inclusive date range, e.g. "Mar 3 – Mar 16". */
export function iterationRangeLabel(iteration: IterationInfo): string {
	const start = startMs(iteration);
	if (!Number.isFinite(start)) return '';
	const end = start + durationMs(iteration) - DAY_MS;
	return `${dayFormatter.format(new Date(start))} – ${dayFormatter.format(new Date(end))}`;
}
