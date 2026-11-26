<script lang="ts">
	import type { IssueRecord, IterationInfo, LinkedPR } from '#lib/github';
	import { iterationRangeLabel, iterationStatusLabel } from '#lib/github';
	import {
		BADGES_HEIGHT,
		CARD_BORDER,
		CARD_GAP,
		CARD_PAD,
		HEADER_HEIGHT,
		LABELS_HEIGHT,
		META_HEIGHT,
		MILESTONE_HEIGHT,
		TITLE_LINE_HEIGHT,
		cardRows
	} from './card-metrics';

	interface Props {
		issue: IssueRecord;
		/** Open blockers, regardless of the current view filters. */
		openBlockers?: number;
		/** Closed blockers that are not visible on the canvas (open-only mode). */
		resolvedBlockers?: number;
		/** Primary project iteration shown when the board is not filtered by one. */
		iteration?: IterationInfo | null;
		iterationCount?: number;
		showIteration?: boolean;
		selected?: boolean;
	}

	let {
		issue,
		openBlockers = 0,
		resolvedBlockers = 0,
		iteration = null,
		iterationCount = 0,
		showIteration = true,
		selected = false
	}: Props = $props();

	let labels = $derived(issue.labels.slice(0, 2));
	let extraLabels = $derived(issue.labels.length - labels.length);
	let linkedPRs = $derived(issue.linkedPRs.slice(0, 2));
	let extraPRs = $derived(issue.linkedPRs.length - linkedPRs.length);
	let visibleAssignees = $derived(issue.assignees.slice(0, 2));
	let extraAssignees = $derived(issue.assignees.length - visibleAssignees.length);
	let assigneeNames = $derived(issue.assignees.map((assignee) => '@' + assignee.login).join(', '));

	let rows = $derived(cardRows(issue));
	let titleLines = $derived(rows.titleLines);
	let iterationRange = $derived(iteration ? iterationRangeLabel(iteration) : '');
	let iterationTooltip = $derived(
		iteration
			? `Iteration: ${iteration.title}${iterationRange ? ` · ${iterationRange}` : ''} · ${iterationStatusLabel(iteration)}` +
					`${iteration.projectTitle ? ` · ${iteration.projectTitle}` : ''}` +
					`${iterationCount > 1 ? ` · ${iterationCount} iterations` : ''}`
			: ''
	);
	let daysAgo = $derived(
		Math.max(0, Math.floor((Date.now() - new Date(issue.updatedAt).getTime()) / 86400000))
	);
	let updatedLabel = $derived(daysAgo === 0 ? 'today' : `${daysAgo}d ago`);

	let tone = $derived(
		openBlockers > 0
			? 'blocked'
			: issue.state === 'closed'
				? 'closed'
				: issue.assignees.length > 0
					? 'assigned'
					: 'unassigned'
	);
	let blockerTotal = $derived(openBlockers + resolvedBlockers);
	let blockerCount = $derived(
		openBlockers === blockerTotal ? `${openBlockers}` : `${openBlockers}/${blockerTotal}`
	);

	function labelStyle(color: string): string {
		const safe = /^[0-9a-f]{6}$/i.test(color) ? color : 'd4d4d4';
		return `--label-color: #${safe}`;
	}

	function prStatus(pr: LinkedPR): string {
		if (pr.draft === true) return 'draft';
		if (pr.state === 'open') return 'open';
		if (pr.state === 'merged') return 'merged';
		return 'closed';
	}

	function prDotClass(pr: LinkedPR): string {
		if (pr.draft === true) return 'bg-launch';
		if (pr.state === 'open') return 'bg-positive';
		if (pr.state === 'merged') return 'bg-brand-strong';
		return 'bg-quiet';
	}

	function prTitle(pr: LinkedPR): string {
		return `${prStatus(pr).toUpperCase()} PR #${pr.number}${pr.author ? ` by @${pr.author}` : ''} — ${pr.title}`;
	}

	function hideBrokenAvatar(event: Event): void {
		const image = event.currentTarget as HTMLImageElement | null;
		if (image) image.hidden = true;
	}
</script>

<div
	class={[
		'issue-card relative flex h-full w-full flex-col rounded-2xl border bg-paper text-ink',
		{ 'issue-card-selected': selected }
	]}
	data-tone={tone}
	style={`gap: ${CARD_GAP}px; padding: ${CARD_PAD}px; border-width: ${CARD_BORDER}px; --card-border-width: ${CARD_BORDER}px;`}
>
	<header class="flex shrink-0 items-center gap-2" style={`height: ${HEADER_HEIGHT}px`}>
		<span class="font-mono text-[11px] leading-none text-quiet tabular-nums">
			#{issue.number}
		</span>
		{#if issue.state === 'closed'}
			<span
				class="font-mono text-[10px] leading-none font-medium tracking-[0.08em] text-muted uppercase"
			>
				closed
			</span>
		{/if}

		<div class="ml-auto flex min-w-0 items-center gap-1.5">
			{#if issue.assignees.length === 0}
				<span class="shrink-0 text-[10.5px] leading-none font-medium text-muted"> Unassigned </span>
			{:else}
				<span class="flex min-w-0 items-center gap-1.5" title={assigneeNames}>
					<span class="flex shrink-0 -space-x-1">
						{#each visibleAssignees as assignee (assignee.login)}
							<span
								class="relative h-[18px] w-[18px] shrink-0 overflow-hidden rounded-full bg-warm ring-2 ring-paper"
							>
								<span
									class="absolute inset-0 flex items-center justify-center font-mono text-[8px] font-medium text-muted"
									aria-hidden="true"
								>
									{assignee.login.slice(0, 1).toUpperCase()}
								</span>
								<img
									src={assignee.avatarUrl}
									alt=""
									loading="lazy"
									class="relative h-full w-full object-cover"
									onerror={hideBrokenAvatar}
								/>
							</span>
						{/each}
					</span>
					<span class="truncate text-[10.5px] leading-none font-medium text-muted">
						{assigneeNames}
					</span>
					{#if extraAssignees > 0}
						<span class="shrink-0 font-mono text-[9px] leading-none text-quiet">
							+{extraAssignees}
						</span>
					{/if}
				</span>
			{/if}

			{#if openBlockers > 0}
				<span
					class="blocked-badge shrink-0"
					title={`${openBlockers} of ${blockerTotal} blockers open`}
				>
					<span class="sr-only">
						{openBlockers} of {blockerTotal}
						{blockerTotal === 1 ? 'blocker' : 'blockers'} open
					</span>
					<svg class="blocked-icon" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
						<circle cx="12" cy="12" r="9" fill="currentColor" />
						<line
							x1="6.2"
							y1="17.8"
							x2="17.8"
							y2="6.2"
							stroke="#fffdfa"
							stroke-width="2.2"
							stroke-linecap="round"
						/>
					</svg>
					<span class="blocked-label" aria-hidden="true">blocked</span>
					<span class="blocked-count" aria-hidden="true">{blockerCount}</span>
				</span>
			{/if}
		</div>
	</header>

	<p
		class="shrink-0 overflow-hidden text-[15px] font-semibold tracking-[-0.014em] text-ink"
		style={`height: ${titleLines * TITLE_LINE_HEIGHT}px; line-height: ${TITLE_LINE_HEIGHT}px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: ${titleLines};`}
		title={issue.title}
	>
		{issue.title}
	</p>

	{#if rows.labels}
		<div
			class="flex shrink-0 items-center gap-1.5 overflow-hidden"
			style={`height: ${LABELS_HEIGHT}px`}
		>
			{#each labels as label (label.name)}
				<span
					class="inline-flex h-5 max-w-[112px] shrink-0 items-center gap-1 rounded-[5px] border border-chip-line bg-chip px-1.5 text-[10.5px] leading-none font-medium text-muted"
					style={labelStyle(label.color)}
					title={label.name}
				>
					<span class="label-dot h-[5px] w-[5px] shrink-0 rounded-full" aria-hidden="true"></span>
					<span class="min-w-0 truncate">{label.name}</span>
				</span>
			{/each}
			{#if extraLabels > 0}
				<span class="shrink-0 font-mono text-[9px] leading-none text-quiet">+{extraLabels}</span>
			{/if}
		</div>
	{/if}

	{#if rows.milestone && issue.milestone}
		<div
			class="flex shrink-0 items-center gap-2 overflow-hidden text-[10.5px] leading-none"
			style={`height: ${MILESTONE_HEIGHT}px`}
			title={`Milestone: ${issue.milestone.title}`}
		>
			<svg
				class="shrink-0 text-brand"
				width="11"
				height="11"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
				<line x1="4" x2="4" y1="22" y2="15" />
			</svg>
			<span class="truncate font-medium text-muted">{issue.milestone.title}</span>
		</div>
	{/if}

	<div
		class="flex shrink-0 items-center gap-2.5 overflow-hidden text-[10.5px] leading-none text-quiet"
		style={`height: ${META_HEIGHT}px`}
	>
		<span
			class="inline-flex shrink-0 items-center gap-1"
			title={issue.reactions ? `${issue.reactions.total} reactions` : 'Reactions unknown'}
		>
			<svg
				width="11"
				height="11"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path
					d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
				/>
			</svg>
			<span class="sr-only">reactions</span>
			<span class="font-medium text-muted tabular-nums">
				{issue.reactions ? issue.reactions.total : '?'}
			</span>
		</span>

		<span class="h-2.5 w-px shrink-0 bg-line" aria-hidden="true"></span>

		<span
			class="inline-flex min-w-0 items-center gap-1"
			title={`Updated ${daysAgo === 0 ? 'today' : `${daysAgo} days ago`}`}
		>
			<svg
				class="shrink-0"
				width="11"
				height="11"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="10" />
				<polyline points="12 6 12 12 16 14" />
			</svg>
			<span class="sr-only">updated</span>
			<span class="truncate font-medium text-muted">{updatedLabel}</span>
		</span>

		{#if resolvedBlockers > 0}
			<span class="h-2.5 w-px shrink-0 bg-line" aria-hidden="true"></span>
			<span
				class="inline-flex shrink-0 items-center gap-1 text-quiet"
				title={`${resolvedBlockers} resolved ${resolvedBlockers === 1 ? 'blocker' : 'blockers'}`}
			>
				<svg
					width="11"
					height="11"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
					<polyline points="22 4 12 14.01 9 11.01" />
				</svg>
				<span class="font-medium text-muted tabular-nums">{resolvedBlockers}</span>
				resolved
				{resolvedBlockers === 1 ? 'blocker' : 'blockers'}
			</span>
		{/if}
	</div>

	{#if rows.badges}
		<div
			class="flex shrink-0 items-center gap-1.5 overflow-hidden"
			style={`height: ${BADGES_HEIGHT}px`}
		>
			{#each linkedPRs as pr (pr.number)}
				<span
					class="inline-flex h-5 shrink-0 items-center gap-1 rounded-[5px] border border-chip-line bg-chip px-1.5 leading-none"
					title={prTitle(pr)}
				>
					<span class="h-1.5 w-1.5 rounded-full {prDotClass(pr)}" aria-hidden="true"></span>
					<span class="font-mono text-[9.5px] font-medium tracking-[0.06em] text-muted uppercase">
						{prStatus(pr)}
					</span>
					<span class="font-mono text-[10px] font-medium text-muted tabular-nums">
						#{pr.number}
					</span>
				</span>
			{/each}
			{#if extraPRs > 0}
				<span class="shrink-0 font-mono text-[9px] leading-none text-quiet">+{extraPRs}</span>
			{/if}
		</div>
	{/if}

	{#if showIteration && iteration}
		<span class="iteration-sticker" title={iterationTooltip}>
			<svg
				width="9"
				height="9"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="m17 2 4 4-4 4" />
				<path d="M3 11v-1a4 4 0 0 1 4-4h14" />
				<path d="m7 22-4-4 4-4" />
				<path d="M21 13v1a4 4 0 0 1-4 4H3" />
			</svg>
			<span class="sr-only">Iteration: </span>
			<span class="iteration-sticker-title">{iteration.title}</span>
			{#if iterationCount > 1}
				<span class="iteration-sticker-count">+{iterationCount - 1}</span>
			{/if}
		</span>
	{/if}
</div>

<style>
	.issue-card {
		--card-border: var(--color-warm);
		border-color: var(--card-border);
		box-shadow: 0 1px 2px rgb(16 16 16 / 0.04);
		cursor: pointer;
		transition:
			box-shadow 160ms ease-out,
			transform 160ms ease-out,
			border-color 160ms ease-out;
	}

	.issue-card[data-tone='assigned'] {
		--card-border: var(--color-brand);
	}

	.issue-card[data-tone='blocked'] {
		--card-border: #e5484d;
	}

	.issue-card[data-tone='closed'] {
		--card-border: var(--color-warm);
	}

	/*
	 * Chromium can square off the corners of an outline on a card inside the
	 * flow's transformed viewport. A border on a pseudo-element is painted as
	 * part of the card's own rounded box, so the ring always follows the radius.
	 */
	.issue-card-selected {
		outline: none;
	}

	.issue-card-selected::after {
		content: '';
		position: absolute;
		/* Ring stroke sits 2px outside the border box, offset from the padding box. */
		inset: calc(-1 * (var(--card-border-width) + 3.5px));
		border: 1.5px solid color-mix(in srgb, var(--card-border) 65%, transparent);
		border-radius: calc(1rem + 3.5px);
		pointer-events: none;
	}

	@media (hover: hover) and (pointer: fine) {
		.issue-card:hover {
			box-shadow:
				0 0 0 5px color-mix(in srgb, var(--card-border) 30%, transparent),
				0 2px 8px -4px rgb(16 16 16 / 0.18);
		}

		.issue-card[data-tone='assigned']:hover {
			--card-border: var(--color-brand-strong);
		}

		.issue-card[data-tone='blocked']:hover {
			--card-border: #d63a3f;
		}

		.issue-card[data-tone='unassigned']:hover,
		.issue-card[data-tone='closed']:hover {
			--card-border: #c9bcb0;
		}

		/* Selection already has the strongest outline; don't stack a second ring. */
		.issue-card.issue-card-selected:hover {
			box-shadow: 0 1px 2px rgb(16 16 16 / 0.04);
		}
	}

	.issue-card:active {
		transform: translateY(0) scale(0.994);
		transition-duration: 90ms;
	}

	.label-dot {
		background: color-mix(in srgb, var(--label-color) 72%, var(--color-ink));
		box-shadow: 0 0 0 1px rgb(16 16 16 / 0.06);
	}

	.blocked-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 20px;
		padding: 0 3px 0 5px;
		border: 1px solid #f5c7c5;
		border-radius: 6px;
		background: #fff2f1;
		white-space: nowrap;
	}

	.blocked-icon {
		flex: none;
		color: var(--color-alert-strong);
	}

	.blocked-label {
		color: #aa292c;
		font-family: var(--font-mono);
		font-size: 9.5px;
		font-weight: 500;
		letter-spacing: 0.07em;
		line-height: 1;
		text-transform: uppercase;
	}

	.blocked-count {
		display: inline-flex;
		align-items: center;
		height: 12px;
		padding: 0 4px;
		border-radius: 4px;
		background: var(--color-alert-strong);
		color: #fffdfa;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0;
		line-height: 1;
	}

	.iteration-sticker {
		position: absolute;
		top: -8px;
		right: -5px;
		z-index: 2;
		display: inline-flex;
		align-items: center;
		gap: 3px;
		max-width: min(160px, calc(100% - 26px));
		height: 18px;
		padding: 0 6px;
		border: 1px solid color-mix(in oklab, var(--color-chip-line) 72%, var(--color-quiet));
		border-radius: 5px;
		background: var(--color-chip);
		box-shadow:
			0 2px 5px -2px rgb(16 16 16 / 0.28),
			0 1px 0 rgb(255 255 255 / 0.65) inset;
		color: var(--color-muted);
		font-family: var(--font-mono);
		font-size: 8.5px;
		font-weight: 500;
		letter-spacing: 0.04em;
		line-height: 1;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.iteration-sticker svg {
		flex: none;
		color: var(--color-brand-strong);
	}

	.iteration-sticker-title {
		overflow: hidden;
		min-width: 0;
		text-overflow: ellipsis;
	}

	.iteration-sticker-count {
		flex: none;
		color: var(--color-quiet);
		font-size: 8px;
		letter-spacing: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.issue-card {
			transition: none;
		}

		.issue-card:hover,
		.issue-card:active {
			transform: none;
		}
	}
</style>
