<script lang="ts">
	import type { DiffPullRequest, IssueUpdateField, RepoDiff } from '#lib/github';
	import { Issue } from 'loadsv';
	import Icon from '#lib/ui/Icon.svelte';

	interface Props {
		refreshing: boolean;
		progress: string;
		diff: RepoDiff | null;
		checkedAt: string | null;
		note: string | null;
		ondismiss: () => void;
	}

	let { refreshing, progress, diff, checkedAt, note, ondismiss }: Props = $props();

	const MAX_LINES = 20;
	const checkTimeFormatter = new Intl.DateTimeFormat(undefined, {
		hour: '2-digit',
		minute: '2-digit'
	});
	const checkDateFormatter = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric'
	});
	const FIELD_LABELS: Record<IssueUpdateField, string> = {
		title: 'title',
		assignees: 'assignees',
		labels: 'labels',
		milestone: 'milestone',
		iteration: 'iteration',
		linkedPRs: 'linked PRs',
		comments: 'comments',
		reactions: 'reactions',
		details: 'details'
	};

	interface NoticeLine {
		key: string;
		text: string;
	}

	function countLabel(count: number, singular: string, plural: string): string {
		return `${count} ${count === 1 ? singular : plural}`;
	}

	function formatCheckTime(iso: string): string {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return '';
		const now = new Date();
		return date.toDateString() === now.toDateString()
			? checkTimeFormatter.format(date)
			: `${checkDateFormatter.format(date)}, ${checkTimeFormatter.format(date)}`;
	}

	function prStateLabel(pr: DiffPullRequest): string {
		if (pr.from === null && pr.to === 'open') return 'linked (open)';
		if (pr.from === null) return `linked (${pr.to})`;
		if (pr.to === null) return 'no longer linked';
		return `${pr.from} → ${pr.to}`;
	}

	let checkedLabel = $derived(checkedAt ? formatCheckTime(checkedAt) : '');
	let summary = $derived.by((): string[] => {
		if (!diff || !diff.hasChanges) return [];

		const parts: string[] = [];
		if (diff.addedIssues.length) {
			parts.push(countLabel(diff.addedIssues.length, 'new issue', 'new issues'));
		}
		if (diff.closedIssues.length) {
			parts.push(countLabel(diff.closedIssues.length, 'issue closed', 'issues closed'));
		}
		if (diff.reopenedIssues.length) {
			parts.push(countLabel(diff.reopenedIssues.length, 'issue reopened', 'issues reopened'));
		}
		if (diff.removedIssues.length) {
			parts.push(
				countLabel(diff.removedIssues.length, 'issue left the board', 'issues left the board')
			);
		}
		const dependencyChanges = diff.addedEdges.length + diff.removedEdges.length;
		if (dependencyChanges) {
			parts.push(countLabel(dependencyChanges, 'dependency change', 'dependency changes'));
		}
		const prChanges = diff.newPRs.length + diff.changedPRs.length + diff.removedPRs.length;
		if (prChanges) {
			parts.push(countLabel(prChanges, 'PR update', 'PR updates'));
		}
		if (diff.updatedIssues.length) {
			parts.push(countLabel(diff.updatedIssues.length, 'issue updated', 'issues updated'));
		}
		return parts;
	});
	let lines = $derived.by((): NoticeLine[] => {
		if (!diff) return [];

		const out: NoticeLine[] = [];
		for (const issue of diff.addedIssues) {
			out.push({
				key: `added-${issue.number}`,
				text: `#${issue.number} ${issue.title} — opened`
			});
		}
		for (const issue of diff.closedIssues) {
			out.push({
				key: `closed-${issue.number}`,
				text: `#${issue.number} ${issue.title} — closed`
			});
		}
		for (const issue of diff.reopenedIssues) {
			out.push({
				key: `reopened-${issue.number}`,
				text: `#${issue.number} ${issue.title} — reopened`
			});
		}
		for (const issue of diff.removedIssues) {
			out.push({
				key: `removed-${issue.number}`,
				text: `#${issue.number} ${issue.title} — ${
					diff.scope === 'open' ? 'no longer open' : 'removed'
				}`
			});
		}
		for (const edge of diff.addedEdges) {
			out.push({
				key: `edge-added-${edge.from}-${edge.to}`,
				text: `#${edge.from} blocks #${edge.to} — dependency added`
			});
		}
		for (const edge of diff.removedEdges) {
			out.push({
				key: `edge-removed-${edge.from}-${edge.to}`,
				text: `#${edge.from} blocks #${edge.to} — dependency removed`
			});
		}
		for (const pr of diff.newPRs) {
			out.push({
				key: `pr-new-${pr.number}`,
				text: `PR #${pr.number} ${pr.title} — ${prStateLabel(pr)}`
			});
		}
		for (const pr of diff.changedPRs) {
			out.push({
				key: `pr-changed-${pr.number}`,
				text: `PR #${pr.number} ${pr.title} — ${prStateLabel(pr)}`
			});
		}
		for (const pr of diff.removedPRs) {
			out.push({
				key: `pr-removed-${pr.number}`,
				text: `PR #${pr.number} ${pr.title} — ${prStateLabel(pr)}`
			});
		}
		for (const update of diff.updatedIssues) {
			const fields = update.fields.map((field) => FIELD_LABELS[field]).join(', ');
			out.push({
				key: `updated-${update.number}`,
				text: `#${update.number} ${update.title} — ${fields || 'details'} updated`
			});
		}
		return out;
	});
	let visibleLines = $derived(lines.slice(0, MAX_LINES));
	let hiddenCount = $derived(Math.max(0, lines.length - MAX_LINES));
</script>

{#if refreshing}
	<div class="refresh-chip" role="status">
		<Issue size={12} color="var(--color-brand-strong)" />
		<span class="chip-text">{progress || 'Checking GitHub for updates…'}</span>
	</div>
{:else if diff || checkedAt}
	<section class="refresh-notice" role="status" aria-label="Refresh summary">
		<header class="notice-head">
			<span class="notice-icon" aria-hidden="true">
				<Icon name={diff?.hasChanges ? 'refresh' : 'check'} size={14} />
			</span>
			<div class="notice-heading">
				<p class="notice-title">
					{#if diff}
						{diff.hasChanges ? 'Updated from GitHub' : 'Already up to date'}
					{:else}
						Board refreshed
					{/if}
				</p>
				<p class="notice-time">
					Checked {checkedLabel || 'just now'}
					{#if diff?.hasChanges && diff.previousFetchedAt}
						· since {formatCheckTime(diff.previousFetchedAt)}
					{/if}
				</p>
			</div>
			<button
				type="button"
				class="notice-close"
				aria-label="Dismiss refresh summary"
				onclick={ondismiss}
			>
				<Icon name="x" size={13} />
			</button>
		</header>

		{#if diff && diff.hasChanges}
			<p class="notice-summary">{summary.join(' · ')}</p>
			{#if visibleLines.length > 0}
				<ul class="notice-lines">
					{#each visibleLines as line (line.key)}
						<li>{line.text}</li>
					{/each}
				</ul>
			{/if}
			{#if hiddenCount > 0}
				<p class="notice-more">
					+{hiddenCount} more change{hiddenCount === 1 ? '' : 's'}
				</p>
			{/if}
		{:else if diff}
			<p class="notice-summary">No changes since the last fetch.</p>
		{:else}
			<p class="notice-summary">{note ?? 'No earlier snapshot was available to compare.'}</p>
		{/if}
	</section>
{/if}

<style>
	.refresh-chip,
	.refresh-notice {
		pointer-events: auto;
	}

	.refresh-chip {
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: 100%;
		padding: 9px 14px;
		border: 1px solid color-mix(in oklab, var(--color-warm) 82%, white);
		border-radius: 999px;
		background: color-mix(in oklab, var(--color-paper) 92%, transparent);
		box-shadow:
			0 16px 36px -26px rgb(29 29 29 / 0.34),
			0 6px 14px -12px rgb(29 29 29 / 0.16),
			inset 0 1px 0 rgb(255 255 255 / 0.7);
		-webkit-backdrop-filter: blur(18px) saturate(1.3);
		backdrop-filter: blur(18px) saturate(1.3);
		color: var(--color-muted);
		font-family: var(--font-mono);
		font-size: 10px;
		line-height: 1.3;
	}

	.chip-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.refresh-notice {
		width: 100%;
		padding: 11px 12px 12px;
		border: 1px solid color-mix(in oklab, var(--color-warm) 80%, white);
		border-radius: 16px;
		background: color-mix(in oklab, var(--color-paper) 95%, transparent);
		box-shadow:
			0 24px 56px -34px rgb(29 29 29 / 0.34),
			0 10px 24px -18px rgb(29 29 29 / 0.16),
			inset 0 1px 0 rgb(255 255 255 / 0.7);
		-webkit-backdrop-filter: blur(20px) saturate(1.3);
		backdrop-filter: blur(20px) saturate(1.3);
		animation: notice-in 180ms cubic-bezier(0.23, 1, 0.32, 1) both;
	}

	.notice-head {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}

	.notice-icon {
		display: grid;
		flex: none;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 7px;
		background: color-mix(in oklab, var(--color-brand) 9%, transparent);
		color: var(--color-brand-strong);
	}

	.notice-heading {
		flex: 1;
		min-width: 0;
	}

	.notice-title {
		margin: 0;
		color: var(--color-ink);
		font-size: 12px;
		font-weight: 600;
		line-height: 1.3;
		letter-spacing: -0.005em;
	}

	.notice-time {
		margin: 1px 0 0;
		color: var(--color-quiet);
		font-family: var(--font-mono);
		font-size: 8.5px;
		letter-spacing: 0.06em;
		line-height: 1.3;
		text-transform: uppercase;
	}

	.notice-close {
		display: grid;
		flex: none;
		place-items: center;
		width: 26px;
		height: 26px;
		margin: -2px -2px 0 0;
		padding: 0;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--color-quiet);
		cursor: pointer;
		touch-action: manipulation;
		transition:
			background-color 120ms ease,
			color 120ms ease,
			transform 100ms cubic-bezier(0.23, 1, 0.32, 1);
	}

	.notice-close:active {
		transform: scale(0.94);
	}

	.notice-close:focus-visible {
		outline: 2px solid var(--color-brand-strong);
		outline-offset: 1px;
	}

	.notice-summary {
		margin: 8px 0 0;
		color: var(--color-muted);
		font-size: 11px;
		line-height: 1.45;
	}

	.notice-lines {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-height: 168px;
		margin: 8px 0 0;
		padding: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		scrollbar-color: var(--color-warm) transparent;
		list-style: none;
	}

	.notice-lines li {
		position: relative;
		padding-left: 10px;
		color: var(--color-muted);
		font-size: 11px;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}

	.notice-lines li::before {
		content: '';
		position: absolute;
		top: 0.58em;
		left: 0;
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: var(--color-warm);
	}

	.notice-more {
		margin: 6px 0 0;
		color: var(--color-quiet);
		font-family: var(--font-mono);
		font-size: 9px;
		line-height: 1.35;
	}

	@media (hover: hover) and (pointer: fine) {
		.notice-close:hover {
			background: var(--color-chip);
			color: var(--color-ink);
		}
	}

	@media (pointer: coarse) {
		.notice-close {
			width: 34px;
			height: 34px;
			margin: -4px -4px 0 0;
		}
	}

	@media (max-height: 540px) {
		.notice-lines {
			max-height: 96px;
		}
	}

	@media (prefers-reduced-transparency: reduce) {
		.refresh-chip,
		.refresh-notice {
			background: var(--color-paper);
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.refresh-notice {
			animation: none;
		}

		.notice-close {
			transition: none;
		}

		.notice-close:active {
			transform: none;
		}
	}

	@keyframes notice-in {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
</style>
