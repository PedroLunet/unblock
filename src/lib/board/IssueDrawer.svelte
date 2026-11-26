<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		GithubError,
		iterationKey,
		iterationRangeLabel,
		iterationStatusLabel,
		resolveRef,
		uniqueIterations,
		updateIssue
	} from '#lib/github';
	import type { DependencyRef, IssueRecord, IssueUpdate, LinkedPR, RepoData } from '#lib/github';
	import { cleanNext } from '#lib/auth/next.ts';
	import { canWriteIssues, session } from '#lib/auth/session.svelte.ts';
	import { Issue } from 'loadsv';
	import Drawer from '#lib/ui/Drawer.svelte';
	import IssueSidebar from './IssueSidebar.svelte';

	interface Props {
		issue: IssueRecord | null;
		data: RepoData | null;
		open: boolean;
		owner: string;
		repo: string;
		/** Current board URL, used as the post-sign-in destination. */
		authNext: string;
		onclose: () => void;
		onupdated: (update: IssueUpdate) => void;
	}

	let { issue, data, open, owner, repo, authNext, onclose, onupdated }: Props = $props();

	interface StateChange {
		number: number;
		saving: boolean;
		error: string | null;
	}

	let stateChange = $state<StateChange | null>(null);
	let contentRoot = $state<HTMLElement | null>(null);

	let canEdit = $derived(session.user !== null && canWriteIssues(session.user.scopes));
	let authTarget = $derived(cleanNext(authNext));
	let stateSaving = $derived(
		stateChange !== null &&
			issue !== null &&
			stateChange.number === issue.number &&
			stateChange.saving
	);
	let stateError = $derived(
		stateChange !== null && issue !== null && stateChange.number === issue.number
			? stateChange.error
			: null
	);

	async function toggleState(): Promise<void> {
		if (!issue || !canEdit || stateSaving) return;
		const number = issue.number;
		const next = issue.state === 'open' ? 'closed' : 'open';
		stateChange = { number, saving: true, error: null };
		try {
			const update = await updateIssue(issue.id, { state: next });
			stateChange = null;
			onupdated(update);
		} catch (err) {
			stateChange = {
				number,
				saving: false,
				error: err instanceof GithubError ? err.message : 'Could not update the issue on GitHub.'
			};
			if (err instanceof GithubError && err.kind === 'auth') void session.refresh();
			const scroller = contentRoot?.parentElement;
			if (scroller) scroller.scrollTop = 0;
		}
	}

	interface ResolvedRefRow {
		number: number;
		label: string;
		href: string | null;
	}

	function resolveRows(repo: RepoData, refs: DependencyRef[]): ResolvedRefRow[] {
		return refs.map((ref) => {
			const resolution = resolveRef(repo, ref.number);
			if (resolution.kind === 'issue') {
				return {
					number: ref.number,
					label: `#${ref.number} (${resolution.issue.state})`,
					href: resolution.issue.url
				};
			}
			if (resolution.kind === 'pr') {
				return {
					number: ref.number,
					label: `PR #${ref.number}`,
					href: resolution.pr.url
				};
			}
			return {
				number: ref.number,
				label: `#${ref.number} (missing)`,
				href: null
			};
		});
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
		if (pr.state === 'merged') return 'bg-brand';
		return 'bg-quiet';
	}

	function daysAgo(iso: string): number {
		return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
	}

	let blockedBy = $derived(issue && data ? resolveRows(data, issue.blockedBy) : []);
	let blocks = $derived(issue && data ? resolveRows(data, issue.blocks) : []);

	$effect(() => {
		const number = issue?.number;
		if (number === undefined) return;
		const scroller = contentRoot?.parentElement;
		if (scroller) scroller.scrollTop = 0;
	});
</script>

{#snippet header()}
	{#if issue}
		<div class="flex flex-col gap-1.5">
			<div class="flex items-center gap-2">
				<span class="font-mono text-[11px] leading-none text-quiet tabular-nums">
					#{issue.number}
				</span>
				{#if issue.state === 'closed'}
					<span
						class="font-mono text-[9.5px] leading-none font-medium tracking-[0.08em] text-muted uppercase"
					>
						closed
					</span>
				{/if}
			</div>
			<a
				class="line-clamp-2 text-[15px] leading-snug font-semibold tracking-[-0.014em] text-ink decoration-warm underline-offset-2 hover:text-brand hover:underline"
				href={issue.url}
				target="_blank"
				rel="external noreferrer"
			>
				{issue.title}
			</a>
			<p class="font-mono text-[10px] leading-4 text-quiet">
				by <span class="text-muted">{issue.author ? `@${issue.author}` : 'unknown'}</span>
				· opened {daysAgo(issue.createdAt)}d ago · updated {daysAgo(issue.updatedAt)}d ago
			</p>
			{#each uniqueIterations(issue.iterations) as iteration (iterationKey(iteration))}
				<p class="font-mono text-[10px] leading-4 text-quiet">
					iteration
					<span class="text-muted">{iteration.title}</span>
					{#if iterationRangeLabel(iteration)}
						· {iterationRangeLabel(iteration)}
					{/if}
					· {iterationStatusLabel(iteration)}
					{#if iteration.projectTitle}
						· {iteration.projectTitle}
					{/if}
				</p>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet actions()}
	{#if issue}
		{#if canEdit}
			<button
				type="button"
				class="secondary-action"
				disabled={stateSaving}
				aria-busy={stateSaving}
				onclick={() => void toggleState()}
			>
				{#if stateSaving}<Issue size={12} />{/if}
				{stateSaving
					? issue.state === 'open'
						? 'Closing…'
						: 'Reopening…'
					: issue.state === 'open'
						? 'Close issue'
						: 'Reopen issue'}
			</button>
		{:else if session.user}
			<form method="GET" action={resolve('/auth/github/start')} class="contents">
				<input type="hidden" name="next" value={authTarget} />
				<input type="hidden" name="write" value="1" />
				<button
					type="submit"
					class="secondary-action"
					title="Requests write access so unblock can edit issues"
				>
					Enable editing
				</button>
			</form>
		{:else if session.configured && !session.loading}
			<form method="GET" action={resolve('/auth/github/start')} class="contents">
				<input type="hidden" name="next" value={authTarget} />
				<input type="hidden" name="write" value="1" />
				<button
					type="submit"
					class="secondary-action"
					title="Sign in with write access to edit this issue"
				>
					Sign in to edit
				</button>
			</form>
		{/if}
		<a class="primary-action" href={issue.url} target="_blank" rel="external noreferrer">
			Open on GitHub
			<svg
				width="12"
				height="12"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M7 17 17 7" />
				<path d="M7 7h10v10" />
			</svg>
		</a>
	{/if}
{/snippet}

<Drawer
	{open}
	{onclose}
	label={issue ? `Issue #${issue.number}: ${issue.title}` : 'Issue details'}
	header={issue && data ? header : undefined}
	actions={issue && data ? actions : undefined}
>
	{#if issue && data}
		<div bind:this={contentRoot} class="flex flex-col gap-4 text-sm text-ink">
			{#if stateError}
				<p
					class="rounded-lg border border-alert/25 bg-[#fff2f1] px-3 py-2 text-xs leading-relaxed text-[#a9272a]"
					role="alert"
				>
					{stateError}
				</p>
			{/if}

			{#key issue.number}
				<IssueSidebar {issue} {owner} {repo} {canEdit} {open} {onupdated} />
			{/key}

			<section class="flex flex-col gap-1.5 text-[11.5px]">
				<h2 class="font-mono text-[9px] font-medium tracking-[0.1em] text-quiet uppercase">
					blocked by
				</h2>
				{#if blockedBy.length === 0}
					<p class="text-quiet">—</p>
				{:else}
					{#each blockedBy as row (row.number)}
						<div class="flex items-center gap-2">
							{#if row.href}
								<a
									class="text-muted decoration-warm underline-offset-2 hover:text-brand hover:underline"
									href={row.href}
									target="_blank"
									rel="external noreferrer"
								>
									{row.label}
								</a>
							{:else}
								<span class="text-quiet">{row.label}</span>
							{/if}
						</div>
					{/each}
				{/if}
			</section>

			<section class="flex flex-col gap-1.5 text-[11.5px]">
				<h2 class="font-mono text-[9px] font-medium tracking-[0.1em] text-quiet uppercase">
					blocks
				</h2>
				{#if blocks.length === 0}
					<p class="text-quiet">—</p>
				{:else}
					{#each blocks as row (row.number)}
						<div class="flex items-center gap-2">
							{#if row.href}
								<a
									class="text-muted decoration-warm underline-offset-2 hover:text-brand hover:underline"
									href={row.href}
									target="_blank"
									rel="external noreferrer"
								>
									{row.label}
								</a>
							{:else}
								<span class="text-quiet">{row.label}</span>
							{/if}
						</div>
					{/each}
				{/if}
			</section>

			<section class="flex flex-col gap-1.5">
				<h2 class="font-mono text-[9px] font-medium tracking-[0.1em] text-quiet uppercase">
					linked PRs
				</h2>
				{#if issue.linkedPRs.length === 0}
					<p class="text-[11.5px] text-quiet">—</p>
				{:else}
					{#each issue.linkedPRs as pr (pr.number)}
						<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
							<a
								class="inline-flex items-center gap-1.5 text-[11.5px] text-muted hover:text-brand"
								href={pr.url}
								target="_blank"
								rel="external noreferrer"
							>
								<span class="h-1.5 w-1.5 rounded-full {prDotClass(pr)}" aria-hidden="true"></span>
								<span class="font-mono text-[9px] font-medium tracking-[0.06em] uppercase">
									{prStatus(pr)}
								</span>
								<span class="font-mono text-[10px] tabular-nums">PR #{pr.number}</span>
							</a>
							{#if pr.author}
								<span class="text-[10.5px] text-quiet">by @{pr.author}</span>
							{/if}
							{#if pr.crossRepository}
								<span class="font-mono text-[9px] tracking-[0.04em] text-quiet uppercase">
									cross-repo
								</span>
							{/if}
							{#if pr.mergeStateUnknown}
								<span class="font-mono text-[9px] tracking-[0.04em] text-quiet uppercase">
									merge state unknown
								</span>
							{/if}
						</div>
					{/each}
				{/if}
			</section>

			<section class="flex flex-col gap-1.5">
				<h2 class="font-mono text-[9px] font-medium tracking-[0.1em] text-quiet uppercase">
					description
				</h2>
				{#if issue.body.trim()}
					<p class="text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted">
						{issue.body}
					</p>
				{:else}
					<p class="text-[11.5px] text-quiet">No description.</p>
				{/if}
			</section>
		</div>
	{/if}
</Drawer>

<style>
	.primary-action {
		display: inline-flex;
		height: 44px;
		align-items: center;
		gap: 6px;
		padding: 0 12px;
		border-radius: 8px;
		background: var(--color-brand-strong);
		color: var(--color-paper);
		font-size: 12px;
		font-weight: 600;
		line-height: 1;
		text-decoration: none;
		touch-action: manipulation;
		transition: transform 100ms ease-out;
	}

	.primary-action:active {
		transform: scale(0.97);
	}

	.primary-action:focus-visible {
		outline: 2px solid var(--color-brand-strong);
		outline-offset: 2px;
	}

	.primary-action:disabled {
		cursor: default;
		opacity: 0.55;
	}

	.secondary-action {
		display: inline-flex;
		height: 44px;
		align-items: center;
		gap: 6px;
		padding: 0 12px;
		border: 1px solid var(--color-warm);
		border-radius: 8px;
		background: var(--color-paper);
		color: var(--color-ink);
		font-family: inherit;
		font-size: 12px;
		font-weight: 600;
		line-height: 1;
		text-decoration: none;
		cursor: pointer;
		touch-action: manipulation;
		transition:
			background-color 120ms ease-out,
			transform 100ms ease-out;
	}

	.secondary-action:active {
		transform: scale(0.97);
	}

	.secondary-action:focus-visible {
		outline: 2px solid var(--color-brand-strong);
		outline-offset: 2px;
	}

	.secondary-action:disabled {
		cursor: default;
		opacity: 0.5;
	}

	@media (min-width: 1024px) {
		.primary-action {
			height: 32px;
		}

		.secondary-action {
			height: 32px;
		}
	}

	@media (hover: hover) and (pointer: fine) {
		.primary-action:hover:not(:disabled) {
			background: var(--color-brand-deep);
		}

		.secondary-action:hover:not(:disabled) {
			background: var(--color-chip);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.primary-action {
			transition: none;
		}

		.primary-action:active {
			transform: none;
		}

		.secondary-action {
			transition: none;
		}

		.secondary-action:active {
			transform: none;
		}
	}
</style>
