<script lang="ts">
	import { resolveRef } from '#lib/github';
	import type { DependencyRef, IssueRecord, LinkedPR, RepoData } from '#lib/github';
	import Drawer from '#lib/ui/Drawer.svelte';

	interface Props {
		issue: IssueRecord | null;
		data: RepoData | null;
		open: boolean;
		onclose: () => void;
	}

	let { issue, data, open, onclose }: Props = $props();

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

	function labelStyle(color: string): string {
		const safe = /^[0-9a-f]{6}$/i.test(color) ? color : 'd4d4d4';
		return `--label-color: #${safe}`;
	}

	function daysAgo(iso: string): number {
		return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
	}

	function hideBrokenAvatar(event: Event): void {
		const image = event.currentTarget as HTMLImageElement | null;
		if (image) image.hidden = true;
	}

	let blockedBy = $derived(issue && data ? resolveRows(data, issue.blockedBy) : []);
	let blocks = $derived(issue && data ? resolveRows(data, issue.blocks) : []);
	let contentRoot = $state<HTMLElement | null>(null);

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
		</div>
	{/if}
{/snippet}

{#snippet actions()}
	{#if issue}
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
			<dl class="flex flex-col gap-2 text-[11.5px]">
				<div class="flex gap-2">
					<dt
						class="w-20 shrink-0 font-mono text-[9px] leading-4 tracking-[0.08em] text-quiet uppercase"
					>
						assignees
					</dt>
					<dd class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted">
						{#if issue.assignees.length === 0}
							<span class="font-medium text-muted">Unassigned</span>
						{:else}
							{#each issue.assignees as assignee (assignee.login)}
								<span class="flex items-center gap-1.5">
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
									<span>@{assignee.login}</span>
								</span>
							{/each}
						{/if}
					</dd>
				</div>
				<div class="flex gap-2">
					<dt
						class="w-20 shrink-0 font-mono text-[9px] leading-4 tracking-[0.08em] text-quiet uppercase"
					>
						milestone
					</dt>
					<dd class="min-w-0 text-muted">
						{#if issue.milestone}
							<span class="inline-flex items-center gap-1.5">
								<svg
									class="h-[11px] w-[11px] shrink-0 text-brand"
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
								{issue.milestone.title}
							</span>
						{:else}
							—
						{/if}
					</dd>
				</div>
				<div class="flex gap-2">
					<dt
						class="w-20 shrink-0 font-mono text-[9px] leading-4 tracking-[0.08em] text-quiet uppercase"
					>
						labels
					</dt>
					<dd class="flex min-w-0 flex-wrap gap-1">
						{#if issue.labels.length === 0}
							<span class="text-quiet">—</span>
						{:else}
							{#each issue.labels as label (label.name)}
								<span
									class="inline-flex h-[19px] items-center gap-1 rounded-[5px] border border-chip-line bg-chip px-1.5 text-[10.5px] leading-none font-medium text-muted"
									style={labelStyle(label.color)}
									title={label.name}
								>
									<span class="label-dot h-[5px] w-[5px] shrink-0 rounded-full" aria-hidden="true"
									></span>
									{label.name}
								</span>
							{/each}
						{/if}
					</dd>
				</div>
				<div class="flex gap-2">
					<dt
						class="w-20 shrink-0 font-mono text-[9px] leading-4 tracking-[0.08em] text-quiet uppercase"
					>
						activity
					</dt>
					<dd class="min-w-0 font-mono text-[10px] leading-4 text-quiet">
						reactions <span class="text-muted">
							{issue.reactions ? issue.reactions.total : '?'}
						</span>
						· comments <span class="text-muted">{issue.comments}</span>
					</dd>
				</div>
			</dl>

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

	.label-dot {
		background: color-mix(in srgb, var(--label-color) 72%, var(--color-ink));
		box-shadow: 0 0 0 1px rgb(16 16 16 / 0.06);
	}

	@media (min-width: 1024px) {
		.primary-action {
			height: 32px;
		}
	}

	@media (hover: hover) and (pointer: fine) {
		.primary-action:hover {
			background: var(--color-brand-deep);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.primary-action {
			transition: none;
		}

		.primary-action:active {
			transform: none;
		}
	}
</style>
