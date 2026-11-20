<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Edge } from '@xyflow/svelte';
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import { buildBoard, filterOptions } from '#lib/board/graph.ts';
	import type { BoardModel, BoardNode } from '#lib/board/graph.ts';
	import BoardCanvas from '#lib/board/BoardCanvas.svelte';
	import IssueDrawer from '#lib/board/IssueDrawer.svelte';
	import { GithubError, loadPat, loadRepo } from '#lib/github';
	import type { FetchScope, RepoData } from '#lib/github';

	interface PageParams {
		owner: string;
		repo: string;
	}

	let { params }: { params: PageParams } = $props();

	let owner = $derived(params.owner);
	let repo = $derived(params.repo);
	const initialScope: FetchScope = page.url.searchParams.get('scope') === 'all' ? 'all' : 'open';

	let scope = $state<FetchScope>(initialScope);
	let data = $state<RepoData | null>(null);
	let loading = $state(true);
	let progress = $state('Loading repository…');
	let error = $state<string | null>(null);
	let milestone = $state('all');
	let assignee = $state('all');
	let hasOpenPR = $state(false);
	let nodes = $state.raw<BoardNode[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let counts = $state<BoardModel['counts'] | null>(null);
	let selectedNumber = $state<number | null>(null);
	let canvas: { fitView: () => void } | null = null;

	let selectedIssue = $derived.by(() => {
		if (selectedNumber === null || !data) return null;
		return (
			data.issues.find((issue) => issue.number === selectedNumber) ??
			data.referencedIssues.find((issue) => issue.number === selectedNumber) ??
			null
		);
	});

	let options = $derived(data ? filterOptions(data) : { milestones: [], assignees: [] });

	let loadId = 0;

	$effect(() => {
		const targetScope = scope;
		void load(targetScope);
	});

	async function load(targetScope: FetchScope): Promise<void> {
		const id = ++loadId;
		loading = true;
		progress = 'Loading repository…';
		error = null;
		try {
			const result = await loadRepo(owner, repo, {
				token: loadPat(),
				scope: targetScope,
				refresh: false,
				progress: (message) => {
					if (id === loadId) progress = message;
				}
			});
			if (id !== loadId) return;
			data = result;
			rebuild();
		} catch (err) {
			if (id !== loadId) return;
			if (err instanceof GithubError) {
				error = err.message;
			} else {
				console.error(err);
				error = 'Something went wrong while loading the repository.';
			}
		} finally {
			if (id === loadId) loading = false;
		}
	}

	function rebuild(): void {
		if (!data) return;
		const model = buildBoard(data, { milestone, assignee, hasOpenPR });
		nodes = model.nodes;
		edges = model.edges;
		counts = model.counts;
		canvas?.fitView();
	}

	function handleIssueClick(issueNumber: number): void {
		selectedNumber = issueNumber;
	}
</script>

<div class="flex h-dvh flex-col">
	<header
		class="flex flex-wrap items-center gap-3 border-b border-neutral-300 bg-white px-4 py-2 text-sm"
	>
		<button type="button" class="text-neutral-600" onclick={() => goto(resolve('/'))}>
			← unblock
		</button>
		<a
			class="font-mono text-neutral-900 underline"
			href={`https://github.com/${owner}/${repo}`}
			target="_blank"
			rel="external noreferrer"
		>
			{owner}/{repo}
		</a>

		<div class="flex border border-neutral-300">
			<button
				type="button"
				class="px-2 py-1 text-xs {scope === 'open'
					? 'bg-neutral-900 text-white'
					: 'bg-white text-neutral-700'}"
				onclick={() => (scope = 'open')}
			>
				Open Only
			</button>
			<button
				type="button"
				class="border-l border-neutral-300 px-2 py-1 text-xs {scope === 'all'
					? 'bg-neutral-900 text-white'
					: 'bg-white text-neutral-700'}"
				onclick={() => (scope = 'all')}
			>
				Show All
			</button>
		</div>

		<select
			class="border border-neutral-300 bg-white px-2 py-1 text-xs"
			aria-label="Milestone filter"
			bind:value={milestone}
			onchange={rebuild}
		>
			<option value="all">All milestones</option>
			{#each options.milestones as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>

		<select
			class="border border-neutral-300 bg-white px-2 py-1 text-xs"
			aria-label="Assignee filter"
			bind:value={assignee}
			onchange={rebuild}
		>
			<option value="all">All assignees</option>
			{#each options.assignees as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>

		<label class="flex items-center gap-1.5 text-xs text-neutral-700">
			<input type="checkbox" bind:checked={hasOpenPR} onchange={rebuild} />
			Has open PR
		</label>

		<button
			type="button"
			class="border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900"
			onclick={rebuild}
		>
			Auto-Layout
		</button>

		{#if counts}
			<span class="ml-auto text-xs text-neutral-500">
				{counts.issues} issues · {counts.edges} edges · {counts.chains} chains
			</span>
		{/if}
	</header>

	{#if data && data.meta.warnings.length > 0}
		<details class="border-b border-amber-300 bg-amber-50 px-4 py-1 text-xs text-amber-900">
			<summary class="cursor-pointer">data notes ({data.meta.warnings.length})</summary>
			<ul class="mt-1 flex list-disc flex-col gap-0.5 pl-5">
				{#each data.meta.warnings as warning, index (index)}
					<li>{warning}</li>
				{/each}
			</ul>
		</details>
	{/if}

	<div class="flex min-h-0 flex-1">
		<div class="relative min-h-0 flex-1">
			<SvelteFlowProvider>
				<BoardCanvas
					bind:this={canvas}
					bind:nodes
					bind:edges
					onissueclick={handleIssueClick}
					onpaneclick={() => (selectedNumber = null)}
				/>
			</SvelteFlowProvider>

			{#if loading}
				<div
					class="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-neutral-600"
				>
					{progress || 'Loading…'}
				</div>
			{/if}

			{#if error}
				<div
					class="absolute inset-x-4 top-4 border border-red-300 bg-white p-3 text-sm text-red-700"
				>
					<p>{error}</p>
					<button
						type="button"
						class="mt-2 border border-red-300 px-2 py-1 text-xs text-red-700"
						onclick={() => void load(scope)}
					>
						Retry
					</button>
				</div>
			{/if}

			{#if !loading && counts && counts.issues === 0}
				<div
					class="absolute bottom-4 left-1/2 -translate-x-1/2 border border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-600"
				>
					No issues match the current filters.
				</div>
			{/if}
		</div>

		{#if selectedIssue && data}
			<aside class="w-96 max-w-[40vw] shrink-0">
				<IssueDrawer issue={selectedIssue} {data} onclose={() => (selectedNumber = null)} />
			</aside>
		{/if}
	</div>
</div>
