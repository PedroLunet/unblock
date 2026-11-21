<script lang="ts">
	import { resolveRef } from '#lib/github';
	import type { DependencyRef, IssueRecord, LinkedPR, RepoData } from '#lib/github';
	import { labelStyle } from './labelColor';

	interface Props {
		issue: IssueRecord;
		data: RepoData;
		onclose: () => void;
	}

	let { issue, data, onclose }: Props = $props();

	interface ResolvedRefRow {
		number: number;
		label: string;
		href: string | null;
	}

	function resolveRows(refs: DependencyRef[]): ResolvedRefRow[] {
		return refs.map((ref) => {
			const resolution = resolveRef(data, ref.number);
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
		if (pr.draft === true) return 'DRAFT';
		if (pr.state === 'open') return 'OPEN';
		if (pr.state === 'merged') return 'MERGED';
		return 'CLOSED';
	}

	function daysAgo(iso: string): number {
		return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
	}

	let blockedBy = $derived(resolveRows(issue.blockedBy));
	let blocks = $derived(resolveRows(issue.blocks));
</script>

<div
	class="flex h-full w-full flex-col gap-3 overflow-y-auto border-l border-line bg-white p-4 text-[12px]"
>
	<div class="flex items-start justify-between gap-2">
		<div class="flex items-center gap-2">
			<span class="font-mono text-[11px] text-quiet">#{issue.number}</span>
			<span class="rounded border border-line-strong px-1 text-[10px] text-quiet uppercase">
				{issue.state}
			</span>
		</div>
		<button
			type="button"
			class="rounded-md border border-line-strong px-2 py-0.5 text-[11px] text-quiet transition-colors hover:border-accent hover:text-accent"
			onclick={onclose}
		>
			Close
		</button>
	</div>

	<div class="flex flex-col gap-1">
		<a
			class="text-[13px] font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent"
			href={issue.url}
			target="_blank"
			rel="external noreferrer"
		>
			{issue.title}
		</a>
		<p class="text-[11px] text-quiet">
			by {issue.author ? `@${issue.author}` : 'unknown'} · opened {daysAgo(issue.createdAt)}d ago ·
			updated {daysAgo(issue.updatedAt)}d ago
		</p>
	</div>

	<dl class="flex flex-col gap-1">
		<div class="flex gap-2">
			<dt class="w-20 shrink-0 text-quiet">assignees</dt>
			<dd class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ink">
				{#if issue.assignees.length === 0}
					<span>Unassigned</span>
				{:else}
					{#each issue.assignees as assignee (assignee.login)}
						<span class="flex items-center gap-1">
							<img
								src={assignee.avatarUrl}
								alt=""
								loading="lazy"
								class="h-4 w-4 shrink-0 rounded-full border border-line"
							/>
							<span>@{assignee.login}</span>
						</span>
					{/each}
				{/if}
			</dd>
		</div>
		<div class="flex gap-2">
			<dt class="w-20 shrink-0 text-quiet">milestone</dt>
			<dd class="min-w-0 text-ink">{issue.milestone ? issue.milestone.title : '—'}</dd>
		</div>
		<div class="flex gap-2">
			<dt class="w-20 shrink-0 text-quiet">labels</dt>
			<dd class="flex min-w-0 flex-wrap gap-1">
				{#if issue.labels.length === 0}
					<span class="text-quiet">—</span>
				{:else}
					{#each issue.labels as label (label.name)}
						<span
							class="rounded-[4px] border px-1 text-[10px] leading-[15px]"
							style={labelStyle(label.color)}
						>
							{label.name}
						</span>
					{/each}
				{/if}
			</dd>
		</div>
		<div class="flex gap-2">
			<dt class="w-20 shrink-0 text-quiet">activity</dt>
			<dd class="min-w-0 text-ink">
				reactions {issue.reactions ? issue.reactions.total : '?'} · comments {issue.comments}
			</dd>
		</div>
	</dl>

	<section class="flex flex-col gap-1">
		<h2 class="text-[11px] font-semibold text-quiet">blocked by:</h2>
		{#if blockedBy.length === 0}
			<p class="text-quiet">—</p>
		{:else}
			{#each blockedBy as row (row.number)}
				<div class="flex items-center gap-2">
					{#if row.href}
						<a
							class="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent"
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

	<section class="flex flex-col gap-1">
		<h2 class="text-[11px] font-semibold text-quiet">blocks:</h2>
		{#if blocks.length === 0}
			<p class="text-quiet">—</p>
		{:else}
			{#each blocks as row (row.number)}
				<div class="flex items-center gap-2">
					{#if row.href}
						<a
							class="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent"
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

	<section class="flex flex-col gap-1">
		<h2 class="text-[11px] font-semibold text-quiet">linked PRs:</h2>
		{#if issue.linkedPRs.length === 0}
			<p class="text-quiet">—</p>
		{:else}
			{#each issue.linkedPRs as pr (pr.number)}
				<div class="flex flex-wrap items-center gap-2">
					<a
						class="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent"
						href={pr.url}
						target="_blank"
						rel="external noreferrer"
					>
						{prStatus(pr)} PR #{pr.number}
					</a>
					{#if pr.author}
						<span class="text-quiet">by @{pr.author}</span>
					{/if}
					{#if pr.crossRepository}
						<span class="text-quiet">(cross-repo)</span>
					{/if}
					{#if pr.mergeStateUnknown}
						<span class="text-quiet">(merge state unknown)</span>
					{/if}
				</div>
			{/each}
		{/if}
	</section>

	<section class="flex flex-col gap-1">
		<h2 class="text-[11px] font-semibold text-quiet">description</h2>
		{#if issue.body.trim()}
			<p class="max-h-64 overflow-auto text-[12px] whitespace-pre-wrap text-quiet">
				{issue.body}
			</p>
		{:else}
			<p class="text-[12px] text-quiet">No description.</p>
		{/if}
	</section>

	<a
		class="text-[11px] text-quiet underline hover:text-ink"
		href={issue.url}
		target="_blank"
		rel="external noreferrer"
	>
		Open on GitHub
	</a>
</div>
