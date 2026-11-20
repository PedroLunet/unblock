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
	let assigneeLogins = $derived(issue.assignees.map((assignee) => assignee.login).join(', '));
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
	class="relative flex h-[170px] w-[240px] flex-col gap-1 overflow-hidden rounded-sm border bg-white p-2.5 text-neutral-900 {selected
		? 'border-neutral-900 ring-1 ring-neutral-900'
		: 'border-neutral-300'}"
>
	<Handle type="target" position={Position.Top} style="opacity: 0;" />
	<Handle type="source" position={Position.Bottom} style="opacity: 0;" />

	<div class="flex items-center gap-1.5">
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
			<span class="ml-auto min-w-0 truncate text-[11px] text-neutral-600" title={assigneeLogins}>
				{assigneeLogins}
			</span>
		{/if}
	</div>

	<p class="line-clamp-2 text-[13px] leading-snug font-medium" title={issue.title}>{issue.title}</p>

	{#if labels.length > 0}
		<div class="flex flex-wrap gap-1 overflow-hidden">
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
		<p class="truncate text-[11px] text-neutral-500" title={issue.milestone.title}>
			{issue.milestone.title}
		</p>
	{/if}

	<p class="truncate text-[11px] text-neutral-500">
		reactions {issue.reactions ? issue.reactions.total : '?'} · updated {daysAgo}d ago
	</p>

	{#if data.openBlockers > 0 || data.resolvedBlockers > 0 || data.prRefs.length > 0 || issue.linkedPRs.length > 0}
		<div class="flex flex-wrap gap-1 overflow-hidden">
			{#if data.openBlockers > 0}
				<span class="border border-red-700 px-1 text-[10px] font-bold text-red-700">blocked</span>
			{/if}
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
