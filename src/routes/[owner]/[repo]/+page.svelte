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
	let rebuildId = 0;

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
			await rebuild();
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

	async function rebuild(): Promise<void> {
		if (!data) return;
		const id = ++rebuildId;
		const model = await buildBoard(data, { milestone, assignee, hasOpenPR });
		if (id !== rebuildId) return;
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
		class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-board px-4 py-2 text-[12px]"
	>
		<button
			type="button"
			class="flex items-center gap-2 text-quiet transition-colors hover:text-ink"
			onclick={() => goto(resolve('/'))}
		>
			<span aria-hidden="true">←</span>
			<span class="font-display text-[15px] font-bold tracking-[-0.02em] text-ink">unblock</span>
		</button>
		<a
			class="font-mono text-[12px] text-ink/80 no-underline underline-offset-2 hover:text-ink hover:underline"
			href={`https://github.com/${owner}/${repo}`}
			target="_blank"
			rel="external noreferrer"
		>
			{owner}/{repo}
		</a>

		<div class="flex items-center rounded-md border border-line-strong bg-white p-0.5">
			<button
				type="button"
				class="rounded px-2 py-0.5 text-[11px] transition-colors {scope === 'open'
					? 'bg-accent text-white'
					: 'text-quiet hover:text-ink'}"
				onclick={() => (scope = 'open')}
			>
				Open Only
			</button>
			<button
				type="button"
				class="rounded px-2 py-0.5 text-[11px] transition-colors {scope === 'all'
					? 'bg-accent text-white'
					: 'text-quiet hover:text-ink'}"
				onclick={() => (scope = 'all')}
			>
				Show All
			</button>
		</div>

		<select
			class="h-7 rounded-md border border-line-strong bg-white px-2 text-[11px] text-ink focus:border-accent focus:outline-none"
			aria-label="Milestone filter"
			bind:value={milestone}
			onchange={() => void rebuild()}
		>
			<option value="all">All milestones</option>
			{#each options.milestones as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>

		<select
			class="h-7 rounded-md border border-line-strong bg-white px-2 text-[11px] text-ink focus:border-accent focus:outline-none"
			aria-label="Assignee filter"
			bind:value={assignee}
			onchange={() => void rebuild()}
		>
			<option value="all">All assignees</option>
			{#each options.assignees as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>

		<label class="flex items-center gap-1.5 text-[11px] text-quiet">
			<input
				type="checkbox"
				class="accent-accent"
				bind:checked={hasOpenPR}
				onchange={() => void rebuild()}
			/>
			Has open PR
		</label>

		<button
			type="button"
			class="h-7 rounded-md border border-line-strong bg-white px-2 text-[11px] text-ink transition-colors hover:border-accent hover:text-accent"
			onclick={() => void rebuild()}
		>
			Auto-Layout
		</button>

		<span class="hidden items-center gap-1.5 text-[11px] text-quiet lg:flex">
			<span class="inline-block w-4 border-t border-edge"></span>blocker → dependent
		</span>

		{#if counts}
			<span class="ml-auto text-[11px] text-quiet tabular-nums">
				{counts.issues} issues · {counts.edges} edges · {counts.chains} chains
			</span>
		{/if}
	</header>

	{#if data && data.meta.warnings.length > 0}
		<details class="border-b border-amber-200 bg-amber-50/80 px-4 py-1 text-[11px] text-amber-900">
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
					highlightNodeId={selectedNumber}
					onissueclick={handleIssueClick}
					onpaneclick={() => (selectedNumber = null)}
				/>
			</SvelteFlowProvider>

			{#if loading}
				<div
					class="absolute inset-0 flex items-center justify-center bg-board/70 text-[12px] text-quiet"
				>
					{progress || 'Loading…'}
				</div>
			{/if}

			{#if error}
				<div
					class="absolute inset-x-4 top-4 rounded-lg border border-red-200 bg-white p-3 text-[12px] text-red-700 shadow-card"
				>
					<p>{error}</p>
					<button
						type="button"
						class="mt-2 rounded-md border border-red-200 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
						onclick={() => void load(scope)}
					>
						Retry
					</button>
				</div>
			{/if}

			{#if !loading && counts && counts.issues === 0}
				<div
					class="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg border border-line bg-white px-3 py-2 text-[11px] text-quiet shadow-card"
				>
					No issues match the current filters.
				</div>
			{/if}

			{#if !loading && !error && counts && counts.edges === 0}
				<div
					class="absolute top-4 left-1/2 max-w-md -translate-x-1/2 rounded-lg border border-line bg-white px-3 py-2 text-center text-[11px] text-quiet shadow-card"
				>
					No native blocking relationships in this view. Dependencies come from GitHub's issue
					Relationships attribute only.
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
