<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { NodeProps } from '@xyflow/svelte';
	import type { LinkedPR } from '#lib/github';
	import type { IssueNode as IssueNodeType, IssueState } from './graph';
	import { labelStyle } from './labelColor';

	let { data, selected }: NodeProps<IssueNodeType> = $props();

	// Static maps keep every class literal visible to Tailwind's scanner.
	const STATE_FILL: Record<IssueState, string> = {
		blocked: 'bg-blocked',
		'in-progress': 'bg-progress',
		'in-review': 'bg-review',
		unassigned: 'bg-white',
		closed: 'bg-closed'
	};
	const STATE_LINE: Record<IssueState, string> = {
		blocked: 'border-blocked-line',
		'in-progress': 'border-progress-line',
		'in-review': 'border-review-line',
		unassigned: 'border-line-strong',
		closed: 'border-closed-line'
	};
	const STATE_WORD: Record<IssueState, string> = {
		blocked: 'blocked',
		'in-progress': 'in progress',
		'in-review': 'in review',
		unassigned: 'unassigned',
		closed: 'closed'
	};

	let issue = $derived(data.issue);
	let labels = $derived(issue.labels.slice(0, 2));
	let extraLabels = $derived(issue.labels.length - labels.length);
	let firstAssignee = $derived(issue.assignees[0]);
	let extraAssignees = $derived(Math.max(0, issue.assignees.length - 1));
	let firstPR = $derived(issue.linkedPRs[0]);
	let extraPRs = $derived(Math.max(0, issue.linkedPRs.length - 1));
	let hasFooter = $derived(
		issue.assignees.length > 0 ||
			issue.linkedPRs.length > 0 ||
			data.resolvedBlockers > 0 ||
			!!issue.milestone
	);

	let stateWord = $derived.by(() => {
		if (data.state !== 'blocked') return STATE_WORD[data.state];
		const total = data.openBlockers + data.resolvedBlockers;
		return data.resolvedBlockers > 0
			? `blocked · ${data.openBlockers}/${total}`
			: `blocked · ${data.openBlockers}`;
	});

	function prStatus(pr: LinkedPR): string {
		if (pr.draft === true) return 'draft';
		if (pr.state === 'open') return 'open';
		if (pr.state === 'merged') return 'merged';
		return 'closed';
	}

	function prTone(pr: LinkedPR): string {
		if (pr.draft === true) return 'text-amber-700';
		if (pr.state === 'open') return 'text-green-700';
		if (pr.state === 'merged') return 'text-purple-700';
		return 'text-quiet';
	}

	function prTitle(pr: LinkedPR): string {
		return `${prStatus(pr)} PR #${pr.number}${pr.author ? ` by @${pr.author}` : ''} — ${pr.title}`;
	}
</script>

<div
	class="relative flex h-full w-full flex-col gap-1 overflow-hidden rounded-[10px] border p-2 text-left shadow-card {STATE_FILL[
		data.state
	]} {selected ? 'border-accent ring-2 ring-accent/30' : STATE_LINE[data.state]}"
>
	<!-- Svelte Flow drops edges whose nodes have no handle bounds; these are invisible and unused by the routed geometry. -->
	<Handle type="target" position={Position.Top} style="opacity: 0; pointer-events: none;" />
	<Handle type="source" position={Position.Bottom} style="opacity: 0; pointer-events: none;" />

	<div class="flex h-4 flex-none items-center gap-2">
		<span class="font-mono text-[11px] leading-4 text-ink/80">#{issue.number}</span>
		<span
			class="ml-auto shrink-0 text-[10px] leading-4 tracking-[0.02em] text-quiet"
			title={data.state === 'blocked'
				? `${data.openBlockers} of ${data.openBlockers + data.resolvedBlockers} blockers open`
				: undefined}
		>
			{stateWord}
		</span>
	</div>

	<p
		class="flex-none overflow-hidden text-[13px] leading-[17px] font-medium text-ink"
		title={issue.title}
		style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:{data.titleLines};overflow-wrap:anywhere;"
	>
		{issue.title}
	</p>

	{#if labels.length > 0}
		<div class="flex h-[17px] flex-none items-center gap-1 overflow-hidden">
			{#each labels as label (label.name)}
				<span
					class="max-w-[96px] truncate rounded-[4px] border px-1 text-[10px] leading-[15px]"
					style={labelStyle(label.color)}
				>
					{label.name}
				</span>
			{/each}
			{#if extraLabels > 0}
				<span class="text-[10px] leading-[15px] text-quiet">+{extraLabels}</span>
			{/if}
		</div>
	{/if}

	{#if hasFooter}
		<div class="flex h-4 flex-none items-center gap-2 text-[10px] leading-4 text-quiet">
			<span class="min-w-0 truncate">
				{#if firstAssignee}
					@{firstAssignee.login}{extraAssignees > 0 ? ` +${extraAssignees}` : ''}
				{:else}
					unassigned
				{/if}
			</span>
			<span class="ml-auto flex shrink-0 items-center gap-1.5">
				{#if firstPR}
					<span class={prTone(firstPR)} title={prTitle(firstPR)}>
						{prStatus(firstPR)} #{firstPR.number}
					</span>
					{#if extraPRs > 0}
						<span>+{extraPRs}</span>
					{/if}
				{:else if data.resolvedBlockers > 0}
					<span>{data.resolvedBlockers} resolved</span>
				{:else if issue.milestone}
					<span class="max-w-[110px] truncate" title={issue.milestone.title}>
						{issue.milestone.title}
					</span>
				{/if}
			</span>
		</div>
	{/if}
</div>
