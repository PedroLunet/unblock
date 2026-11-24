<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import type { Edge } from '@xyflow/svelte';
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import { buildBoard, filterOptions } from '#lib/board/graph.ts';
	import type { BoardModel, BoardNode } from '#lib/board/graph.ts';
	import BoardCanvas from '#lib/board/BoardCanvas.svelte';
	import BoardNav from '#lib/board/BoardNav.svelte';
	import IssueDrawer from '#lib/board/IssueDrawer.svelte';
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

	function changeScope(value: FetchScope): void {
		scope = value;
	}

	function changeMilestone(value: string): void {
		milestone = value;
		void rebuild();
	}

	function changeAssignee(value: string): void {
		assignee = value;
		void rebuild();
	}

	function changeHasOpenPR(value: boolean): void {
		hasOpenPR = value;
		void rebuild();
	}
</script>

<div class="h-dvh overflow-hidden bg-canvas">
	<BoardNav
		{owner}
		{repo}
		{scope}
		onscopechange={changeScope}
		{milestone}
		onmilestonechange={changeMilestone}
		{assignee}
		onassigneechange={changeAssignee}
		{hasOpenPR}
		onhasprchange={changeHasOpenPR}
		{options}
		{counts}
		warnings={data?.meta.warnings ?? []}
		{loading}
		{progress}
		{authNext}
		onlayout={() => void rebuild()}
		onsignout={handleSignOut}
	/>

	<div class="relative h-full">
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
				class="board-alert absolute top-4 right-4 left-[84px] rounded-xl border border-alert/25 bg-paper p-3 text-sm text-[#a9272a] shadow-sm"
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
				class="board-hint-bottom absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-warm bg-paper px-3 py-2 text-xs text-muted shadow-sm"
			>
				No issues match the current filters.
			</div>
		{/if}

		{#if !loading && !error && counts && counts.edges === 0}
			<div
				class="board-hint-top absolute top-4 left-1/2 max-w-md -translate-x-1/2 rounded-lg border border-warm bg-paper/95 px-3 py-2 text-center text-xs text-muted shadow-sm"
			>
				No native blocking relationships in this view. Dependencies come from GitHub's issue
				Relationships attribute only.
			</div>
		{/if}
	</div>

	<IssueDrawer issue={drawerIssue} {data} open={drawerOpen} onclose={closeDrawer} />
</div>
