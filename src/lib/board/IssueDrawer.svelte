<script lang="ts">
	import { resolveRef } from '#lib/github';
	import type { DependencyRef, IssueRecord, LinkedPR, RepoData } from '#lib/github';

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
	class="flex h-full w-full flex-col gap-3 overflow-y-auto border-l border-neutral-300 bg-white p-4 text-sm"
>
	<div class="flex items-start justify-between gap-2">
		<div class="flex items-center gap-2">
			<span class="font-mono text-xs text-neutral-500">#{issue.number}</span>
			<span
				class="border px-1 text-[10px] uppercase {issue.state === 'open'
					? 'border-green-600 text-green-700'
					: 'border-neutral-300 text-neutral-500'}"
			>
				{issue.state}
			</span>
		</div>
		<button
			type="button"
			class="border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700"
			onclick={onclose}
		>
			Close
		</button>
	</div>

	<div class="flex flex-col gap-1">
		<a
			class="font-medium text-neutral-900 underline"
			href={issue.url}
			target="_blank"
			rel="external noreferrer"
		>
			{issue.title}
		</a>
		<p class="text-xs text-neutral-500">
			by {issue.author ? `@${issue.author}` : 'unknown'} · opened {daysAgo(issue.createdAt)}d ago ·
			updated {daysAgo(issue.updatedAt)}d ago
		</p>
	</div>

	<dl class="flex flex-col gap-1 text-xs">
		<div class="flex gap-2">
			<dt class="w-20 shrink-0 text-neutral-500">assignees</dt>
			<dd class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-neutral-900">
				{#if issue.assignees.length === 0}
					<span class="font-bold">Unassigned</span>
				{:else}
					{#each issue.assignees as assignee (assignee.login)}
						<span class="flex items-center gap-1">
							<img
								src={assignee.avatarUrl}
								alt=""
								loading="lazy"
								class="h-4 w-4 shrink-0 rounded-full border border-neutral-300"
							/>
							<span>@{assignee.login}</span>
						</span>
					{/each}
				{/if}
			</dd>
		</div>
		<div class="flex gap-2">
			<dt class="w-20 shrink-0 text-neutral-500">milestone</dt>
			<dd class="min-w-0 text-neutral-900">{issue.milestone ? issue.milestone.title : '—'}</dd>
		</div>
		<div class="flex gap-2">
			<dt class="w-20 shrink-0 text-neutral-500">labels</dt>
			<dd class="flex min-w-0 flex-wrap gap-1">
				{#if issue.labels.length === 0}
					<span class="text-neutral-500">—</span>
				{:else}
					{#each issue.labels as label (label.name)}
						<span class="border border-neutral-300 px-1 text-[10px] text-neutral-600">
							{label.name}
						</span>
					{/each}
				{/if}
			</dd>
		</div>
		<div class="flex gap-2">
			<dt class="w-20 shrink-0 text-neutral-500">activity</dt>
			<dd class="min-w-0 text-neutral-900">
				reactions {issue.reactions ? issue.reactions.total : '?'} · comments {issue.comments}
			</dd>
		</div>
	</dl>

	<section class="flex flex-col gap-1 text-xs">
		<h2 class="text-[11px] font-bold tracking-wide text-neutral-500 uppercase">blocked by:</h2>
		{#if blockedBy.length === 0}
			<p class="text-neutral-500">—</p>
		{:else}
			{#each blockedBy as row (row.number)}
				<div class="flex items-center gap-2">
					{#if row.href}
						<a
							class="text-neutral-900 underline"
							href={row.href}
							target="_blank"
							rel="external noreferrer"
						>
							{row.label}
						</a>
					{:else}
						<span class="text-neutral-500">{row.label}</span>
					{/if}
				</div>
			{/each}
		{/if}
	</section>

	<section class="flex flex-col gap-1 text-xs">
		<h2 class="text-[11px] font-bold tracking-wide text-neutral-500 uppercase">blocks:</h2>
		{#if blocks.length === 0}
			<p class="text-neutral-500">—</p>
		{:else}
			{#each blocks as row (row.number)}
				<div class="flex items-center gap-2">
					{#if row.href}
						<a
							class="text-neutral-900 underline"
							href={row.href}
							target="_blank"
							rel="external noreferrer"
						>
							{row.label}
						</a>
					{:else}
						<span class="text-neutral-500">{row.label}</span>
					{/if}
				</div>
			{/each}
		{/if}
	</section>

	<section class="flex flex-col gap-1 text-xs">
		<h2 class="text-[11px] font-bold tracking-wide text-neutral-500 uppercase">linked PRs:</h2>
		{#if issue.linkedPRs.length === 0}
			<p class="text-neutral-500">—</p>
		{:else}
			{#each issue.linkedPRs as pr (pr.number)}
				<div class="flex flex-wrap items-center gap-2">
					<a
						class="text-neutral-900 underline"
						href={pr.url}
						target="_blank"
						rel="external noreferrer"
					>
						{prStatus(pr)} PR #{pr.number}
					</a>
					{#if pr.author}
						<span class="text-neutral-500">by @{pr.author}</span>
					{/if}
					{#if pr.crossRepository}
						<span class="text-neutral-500">(cross-repo)</span>
					{/if}
					{#if pr.mergeStateUnknown}
						<span class="text-neutral-500">(merge state unknown)</span>
					{/if}
				</div>
			{/each}
		{/if}
	</section>

	<section class="flex flex-col gap-1">
		<h2 class="text-[11px] font-bold tracking-wide text-neutral-500 uppercase">description</h2>
		{#if issue.body.trim()}
			<p class="max-h-64 overflow-auto text-xs whitespace-pre-wrap text-neutral-700">
				{issue.body}
			</p>
		{:else}
			<p class="text-xs text-neutral-500">No description.</p>
		{/if}
	</section>

	<a
		class="text-xs text-neutral-500 underline"
		href={issue.url}
		target="_blank"
		rel="external noreferrer"
	>
		Open on GitHub
	</a>
</div>
