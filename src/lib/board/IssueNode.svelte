<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { NodeProps } from '@xyflow/svelte';
	import type { LinkedPR } from '#lib/github';
	import type { IssueNode as IssueNodeType } from './graph';

	let { data, selected }: NodeProps<IssueNodeType> = $props();

	let issue = $derived(data.issue);
	let labels = $derived(issue.labels.slice(0, 2));
	let extraLabels = $derived(issue.labels.length - labels.length);
	let linkedPRs = $derived(issue.linkedPRs.slice(0, 2));
	let extraPRs = $derived(issue.linkedPRs.length - linkedPRs.length);
	let daysAgo = $derived(Math.floor((Date.now() - new Date(issue.updatedAt).getTime()) / 86400000));

	function prStatus(pr: LinkedPR): string {
		if (pr.draft === true) return 'DRAFT';
		if (pr.state === 'open') return 'OPEN';
		if (pr.state === 'merged') return 'MERGED';
		return 'CLOSED';
	}

	function prClass(pr: LinkedPR): string {
		if (pr.draft === true) return 'border-amber-600 text-amber-700';
		if (pr.state === 'open') return 'border-green-600 text-green-700';
		if (pr.state === 'merged') return 'border-purple-600 text-purple-700';
		return 'border-neutral-400 text-neutral-500';
	}

	function prTitle(pr: LinkedPR): string {
		return `${prStatus(pr)} PR #${pr.number}${pr.author ? ` by @${pr.author}` : ''} — ${pr.title}`;
	}
</script>

<div
	class="relative flex h-full w-full flex-col gap-1 overflow-hidden rounded-md border bg-white p-2.5 text-neutral-900 shadow-sm {selected
		? 'border-neutral-900 ring-1 ring-neutral-900'
		: 'border-neutral-300'}"
>
	{#if data.openBlockers > 0}
		<span class="absolute inset-y-0 left-0 w-1 bg-red-700" aria-hidden="true"></span>
	{/if}

	<!-- Svelte Flow drops edges whose nodes have no handle bounds; these are invisible and unused by the routed geometry. -->
	<Handle type="target" position={Position.Top} style="opacity: 0; pointer-events: none;" />
	<Handle type="source" position={Position.Bottom} style="opacity: 0; pointer-events: none;" />

	{#if data.openBlockers > 0}
		{@const total = data.openBlockers + data.resolvedBlockers}
		<span
			class="absolute top-0 right-0 z-10 rounded-bl-sm bg-red-700 px-1.5 py-0.5 text-[10px] leading-none font-bold text-white"
			title={`${data.openBlockers} of ${total} blockers open`}
		>
			{data.openBlockers === total ? data.openBlockers : `${data.openBlockers}/${total}`}
		</span>
	{/if}

	<div class="flex h-[18px] items-center gap-1.5 {data.openBlockers > 0 ? 'pr-7' : ''}">
		<span class="font-mono text-xs text-neutral-500">#{issue.number}</span>
		<span
			class="border px-1 text-[10px] uppercase {issue.state === 'open'
				? 'border-green-600 text-green-700'
				: 'border-neutral-300 text-neutral-500'}"
		>
			{issue.state}
		</span>
		{#if issue.assignees.length === 0}
			<span class="ml-auto border border-neutral-400 px-1 text-[10px] font-bold">Unassigned</span>
		{:else}
			<span class="ml-auto flex min-w-0 items-center gap-1">
				{#each issue.assignees.slice(0, 2) as assignee (assignee.login)}
					<img
						src={assignee.avatarUrl}
						alt=""
						loading="lazy"
						class="h-4 w-4 shrink-0 rounded-full border border-neutral-300"
					/>
				{/each}
				<span class="truncate text-[11px] text-neutral-700">
					{issue.assignees.map((a) => '@' + a.login).join(', ')}
				</span>
				{#if issue.assignees.length > 2}
					<span class="shrink-0 text-[10px] text-neutral-500">+{issue.assignees.length - 2}</span>
				{/if}
			</span>
		{/if}
	</div>

	<p class="line-clamp-3 text-[13px] leading-[17px] font-medium" title={issue.title}>
		{issue.title}
	</p>

	{#if labels.length > 0}
		<div class="flex h-[18px] flex-wrap gap-1 overflow-hidden">
			{#each labels as label (label.name)}
				<span class="border border-neutral-300 px-1 text-[10px] text-neutral-600">
					{label.name}
				</span>
			{/each}
			{#if extraLabels > 0}
				<span class="text-[10px] text-neutral-500">+{extraLabels}</span>
			{/if}
		</div>
	{/if}

	{#if issue.milestone}
		<p class="truncate text-[11px] leading-[15px] text-neutral-500" title={issue.milestone.title}>
			{issue.milestone.title}
		</p>
	{/if}

	<p class="h-[15px] text-[11px] leading-[15px] text-neutral-500">
		reactions {issue.reactions ? issue.reactions.total : '?'} · updated {daysAgo}d ago
	</p>

	{#if data.resolvedBlockers > 0 || data.prRefs.length > 0 || issue.linkedPRs.length > 0}
		<div class="flex h-[18px] flex-wrap items-center gap-1 overflow-hidden">
			{#if data.resolvedBlockers > 0}
				<span class="border border-neutral-300 px-1 text-[10px] text-neutral-500">
					{data.resolvedBlockers}
					{data.resolvedBlockers === 1 ? 'resolved blocker' : 'resolved blockers'}
				</span>
			{/if}
			{#each data.prRefs as prRef (prRef)}
				<span class="border border-dashed border-neutral-300 px-1 text-[10px] text-neutral-500">
					PR #{prRef}
				</span>
			{/each}
			{#each linkedPRs as pr (pr.number)}
				<span class="border px-1 text-[10px] {prClass(pr)}" title={prTitle(pr)}>
					{prStatus(pr)} #{pr.number}
				</span>
			{/each}
			{#if extraPRs > 0}
				<span class="text-[10px] text-neutral-500">+{extraPRs}</span>
			{/if}
		</div>
	{/if}
</div>
