<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Edge } from '@xyflow/svelte';
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import { buildBoard, filterOptions } from '#lib/board/graph.ts';
	import type { BoardModel, BoardNode } from '#lib/board/graph.ts';
	import BoardCanvas from '#lib/board/BoardCanvas.svelte';
	import IssueDrawer from '#lib/board/IssueDrawer.svelte';
	import AuthControls from '#lib/auth/AuthControls.svelte';
	import { session } from '#lib/auth/session.svelte.ts';
	import { GithubError, loadRepo } from '#lib/github';
	import type { FetchScope, IssueRecord, RepoData } from '#lib/github';

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
	let drawerIssue = $state<IssueRecord | null>(null);
	let drawerOpen = $state(false);
	let layoutRevision = $state(0);
	let canvas = $state<{ fitView: () => void } | null>(null);

	let options = $derived(data ? filterOptions(data) : { milestones: [], assignees: [] });
	let authNext = $derived(page.url.pathname + page.url.search);

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
			await session.ensure();
			const result = await loadRepo(owner, repo, {
				auth: session.user ? 'github' : 'anonymous',
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
				if (err.kind === 'auth') void session.refresh();
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
		layoutRevision += 1;
		await tick();
		canvas?.fitView();
	}

	function findIssue(issueNumber: number): IssueRecord | null {
		if (!data) return null;
		return (
			data.issues.find((issue) => issue.number === issueNumber) ??
			data.referencedIssues.find((issue) => issue.number === issueNumber) ??
			null
		);
	}

	function handleIssueClick(issueNumber: number): void {
		const issue = findIssue(issueNumber);
		if (!issue) return;
		selectedNumber = issueNumber;
		drawerIssue = issue;
		drawerOpen = true;
	}

	function closeDrawer(): void {
		drawerOpen = false;
		selectedNumber = null;
	}

	async function handleSignOut(): Promise<void> {
		data = null;
		selectedNumber = null;
		drawerIssue = null;
		drawerOpen = false;
		await load(scope);
	}
</script>

<div class="flex h-dvh flex-col bg-canvas">
	<header
		class="flex flex-wrap items-center gap-4 border-b border-warm/80 bg-canvas/85 px-5 py-2.5 text-sm backdrop-blur-md"
	>
		<button
			type="button"
			class="-ml-2 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-paper hover:text-ink"
			onclick={() => goto(resolve('/'))}
		>
			← unblock
		</button>
		<a
			class="font-mono text-xs font-medium text-ink underline decoration-warm underline-offset-4 hover:decoration-ink"
			href={`https://github.com/${owner}/${repo}`}
			target="_blank"
			rel="external noreferrer"
		>
			{owner}/{repo}
		</a>

		<div class="flex rounded-lg border border-line bg-[#ece6de] p-0.5">
			<button
				type="button"
				class="rounded-[6px] px-2.5 py-1 text-[11px] font-medium transition-colors {scope === 'open'
					? 'bg-paper text-ink shadow-sm'
					: 'text-muted hover:text-ink'}"
				onclick={() => (scope = 'open')}
			>
				Open Only
			</button>
			<button
				type="button"
				class="rounded-[6px] px-2.5 py-1 text-[11px] font-medium transition-colors {scope === 'all'
					? 'bg-paper text-ink shadow-sm'
					: 'text-muted hover:text-ink'}"
				onclick={() => (scope = 'all')}
			>
				Show All
			</button>
		</div>

		<select
			class="rounded-md border border-warm bg-paper px-2 py-1 text-[11px] text-ink shadow-sm focus:ring-2 focus:ring-brand/25 focus:outline-none"
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
			class="rounded-md border border-warm bg-paper px-2 py-1 text-[11px] text-ink shadow-sm focus:ring-2 focus:ring-brand/25 focus:outline-none"
			aria-label="Assignee filter"
			bind:value={assignee}
			onchange={() => void rebuild()}
		>
			<option value="all">All assignees</option>
			{#each options.assignees as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>

		<label class="flex items-center gap-1.5 text-xs text-muted">
			<input
				type="checkbox"
				class="accent-brand"
				bind:checked={hasOpenPR}
				onchange={() => void rebuild()}
			/>
			Has open PR
		</label>

		<button
			type="button"
			class="rounded-md border border-warm bg-paper px-2.5 py-1 text-[11px] font-medium text-ink shadow-sm transition-[background-color,transform] hover:bg-canvas active:scale-[0.98]"
			onclick={() => void rebuild()}
		>
			Auto-Layout
		</button>

		{#if counts}
			<span class="ml-auto font-mono text-[10px] text-quiet">
				{counts.issues} issues · {counts.edges} edges · {counts.chains} chains
			</span>
		{/if}

		<div class="ml-auto">
			<AuthControls next={authNext} showPrivateChoice onsignout={handleSignOut} />
		</div>
	</header>

	{#if data && data.meta.warnings.length > 0}
		<details class="border-b border-[#f0d3ba] bg-[#ffcea5]/20 px-4 py-1 text-xs text-[#7a4a2a]">
			<summary class="cursor-pointer font-medium">data notes ({data.meta.warnings.length})</summary>
			<ul class="mt-1 flex list-disc flex-col gap-0.5 pl-5">
				{#each data.meta.warnings as warning, index (index)}
					<li>{warning}</li>
				{/each}
			</ul>
		</details>
	{/if}

	<div class="flex min-h-0 flex-1">
		<div class="relative min-h-0 flex-1">
			{#key layoutRevision}
				<SvelteFlowProvider>
					<BoardCanvas
						bind:this={canvas}
						bind:nodes
						bind:edges
						highlightNodeId={selectedNumber}
						onissueclick={handleIssueClick}
						onpaneclick={closeDrawer}
					/>
				</SvelteFlowProvider>
			{/key}

			{#if loading}
				<div
					class="absolute inset-0 flex items-center justify-center bg-canvas/70 text-xs text-muted backdrop-blur-sm"
				>
					{progress || 'Loading…'}
				</div>
			{/if}

			{#if error}
				<div
					class="absolute inset-x-4 top-4 rounded-xl border border-alert/25 bg-paper p-3 text-sm text-[#a9272a] shadow-sm"
				>
					<p>{error}</p>
					<button
						type="button"
						class="mt-2 rounded-md border border-alert/25 px-2 py-1 text-xs text-[#a9272a] hover:bg-[#fff2f1]"
						onclick={() => void load(scope)}
					>
						Retry
					</button>
				</div>
			{/if}

			{#if !loading && counts && counts.issues === 0}
				<div
					class="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-warm bg-paper px-3 py-2 text-xs text-muted shadow-sm"
				>
					No issues match the current filters.
				</div>
			{/if}

			{#if !loading && !error && counts && counts.edges === 0}
				<div
					class="absolute top-4 left-1/2 max-w-md -translate-x-1/2 rounded-lg border border-warm bg-paper/95 px-3 py-2 text-center text-xs text-muted shadow-sm"
				>
					No native blocking relationships in this view. Dependencies come from GitHub's issue
					Relationships attribute only.
				</div>
			{/if}
		</div>
	</div>

	<IssueDrawer issue={drawerIssue} {data} open={drawerOpen} onclose={closeDrawer} />
</div>
