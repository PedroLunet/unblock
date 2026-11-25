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
	import RefreshNotice from '#lib/board/RefreshNotice.svelte';
	import { session, canReadProjects } from '#lib/auth/session.svelte.ts';
	import {
		GithubError,
		buildSnapshot,
		clearOtherRepoEntries,
		diffRepo,
		loadRepo,
		readSnapshot,
		repoCacheKey,
		writeRepoCache,
		writeSnapshot
	} from '#lib/github';
	import { clearRepoCache } from '#lib/github/storage.ts';
	import type { FetchScope, IssueRecord, IssueUpdate, RepoData, RepoDiff } from '#lib/github';

	interface PageParams {
		owner: string;
		repo: string;
	}

	interface RefreshOutcome {
		diff: RepoDiff | null;
		checkedAt: string;
		note: string | null;
	}

	interface LoadError {
		message: string;
		retry: 'load' | 'refresh';
	}

	let { params }: { params: PageParams } = $props();

	let owner = $derived(params.owner);
	let repo = $derived(params.repo);
	const initialScope: FetchScope = page.url.searchParams.get('scope') === 'all' ? 'all' : 'open';

	let scope = $state<FetchScope>(initialScope);
	let data = $state<RepoData | null>(null);
	let loading = $state(true);
	let refreshing = $state(false);
	let progress = $state('Loading repository…');
	let error = $state<LoadError | null>(null);
	let refreshNotice = $state<RefreshOutcome | null>(null);
	let milestone = $state('all');
	let iteration = $state('all');
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

	let options = $derived(
		data ? filterOptions(data) : { milestones: [], assignees: [], iterations: [] }
	);
	let projectIterations = $derived(data?.meta.projectIterations ?? 'no-access');
	let authNext = $derived(page.url.pathname + page.url.search);

	let requestId = 0;
	let rebuildId = 0;

	$effect(() => {
		const targetScope = scope;
		void load(targetScope);
	});

	function currentAuth(): 'github' | 'anonymous' {
		return session.user ? 'github' : 'anonymous';
	}

	/** Projects v2 iterations need the `read:project` OAuth scope. */
	function shouldLoadIterations(): boolean {
		return session.user !== null && canReadProjects(session.user.scopes);
	}

	function cacheKeyFor(result: RepoData, auth: 'github' | 'anonymous'): string {
		return repoCacheKey(
			owner,
			repo,
			result.scope,
			auth,
			result.meta.projectIterations !== 'no-access'
		);
	}

	/** Keep the compact diff baseline in localStorage with the full cache. */
	function remember(result: RepoData, auth: 'github' | 'anonymous'): void {
		writeSnapshot(cacheKeyFor(result, auth), buildSnapshot(result));
	}

	/**
	 * A fetch that finishes after sign-out must not resurrect private data:
	 * clear any cache it just wrote and discard the result.
	 */
	function discardSignedOutResult(auth: 'github' | 'anonymous'): boolean {
		if (auth !== 'github' || session.user) return false;
		clearRepoCache();
		return true;
	}

	function handleError(err: unknown, retry: LoadError['retry']): void {
		if (err instanceof GithubError) {
			if (err.kind === 'auth') void session.refresh();
			error = { message: err.message, retry };
			return;
		}
		console.error(err);
		error = {
			message:
				retry === 'refresh'
					? 'Something went wrong while refreshing the repository.'
					: 'Something went wrong while loading the repository.',
			retry
		};
	}

	async function load(targetScope: FetchScope): Promise<void> {
		const id = ++requestId;
		rebuildId += 1;
		loading = true;
		refreshing = false;
		progress = 'Loading repository…';
		error = null;
		refreshNotice = null;
		try {
			await session.ensure();
			if (id !== requestId) return;
			const auth = currentAuth();
			const includeProjectIterations = shouldLoadIterations();
			const result = await loadRepo(owner, repo, {
				auth,
				scope: targetScope,
				refresh: false,
				includeProjectIterations,
				progress: (message) => {
					if (id === requestId) progress = message;
				}
			});
			if (id !== requestId) {
				discardSignedOutResult(auth);
				return;
			}
			if (discardSignedOutResult(auth)) return;
			data = result;
			remember(result, auth);
			await rebuild();
		} catch (err) {
			if (id !== requestId) return;
			handleError(err, 'load');
		} finally {
			if (id === requestId) loading = false;
		}
	}

	async function refresh(): Promise<void> {
		if (loading || refreshing) return;

		const targetScope = scope;
		const previousData = data;
		const id = ++requestId;
		refreshing = true;
		progress = 'Checking GitHub for updates…';
		error = null;
		refreshNotice = null;
		try {
			await session.ensure();
			if (id !== requestId) return;
			const auth = currentAuth();
			const includeProjectIterations = shouldLoadIterations();
			const key = repoCacheKey(owner, repo, targetScope, auth, includeProjectIterations);
			const before = previousData ? buildSnapshot(previousData) : readSnapshot(key);
			const result = await loadRepo(owner, repo, {
				auth,
				scope: targetScope,
				refresh: true,
				includeProjectIterations,
				progress: (message) => {
					if (id === requestId) progress = message;
				}
			});
			if (id !== requestId) {
				discardSignedOutResult(auth);
				return;
			}
			if (discardSignedOutResult(auth)) return;

			let diff: RepoDiff | null = null;
			let note: string | null = null;
			if (!before) {
				note = 'No earlier snapshot was available to compare.';
			} else if (before.source !== result.meta.source || before.scope !== result.scope) {
				note = 'The data source changed, so change details are unavailable.';
			} else {
				try {
					diff = diffRepo(before, result);
				} catch (err) {
					console.error(err);
					note = 'The saved comparison snapshot was unreadable, so change details are unavailable.';
				}
			}

			data = result;
			remember(result, auth);
			syncDrawerIssue(result);
			if (!diff || diff.hasChanges) await rebuild();
			// Sign-out or a scope change may have landed during the ELK rebuild.
			if (id !== requestId || discardSignedOutResult(auth)) return;
			refreshNotice = { diff, checkedAt: result.meta.fetchedAt, note };
		} catch (err) {
			if (id !== requestId) return;
			handleError(err, 'refresh');
		} finally {
			if (id === requestId) refreshing = false;
		}
	}

	function retry(): void {
		if (!error) return;
		if (error.retry === 'refresh') void refresh();
		else void load(scope);
	}

	async function rebuild(): Promise<void> {
		if (!data) return;
		const id = ++rebuildId;
		const model = await buildBoard(data, { milestone, assignee, iteration, hasOpenPR });
		if (id !== rebuildId) return;
		nodes = model.nodes;
		edges = model.edges;
		counts = model.counts;
		layoutRevision += 1;
		await tick();
		canvas?.fitView();
	}

	function findIssueIn(source: RepoData, issueNumber: number): IssueRecord | null {
		return (
			source.issues.find((issue) => issue.number === issueNumber) ??
			source.referencedIssues.find((issue) => issue.number === issueNumber) ??
			null
		);
	}

	function findIssue(issueNumber: number): IssueRecord | null {
		return data ? findIssueIn(data, issueNumber) : null;
	}

	/** Keep an open drawer on the fresh record, or close it if the issue vanished. */
	function syncDrawerIssue(source: RepoData): void {
		if (selectedNumber === null) return;
		const issue = findIssueIn(source, selectedNumber);
		if (!issue) {
			closeDrawer();
			return;
		}
		drawerIssue = issue;
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

	/**
	 * Fold a successful edit into the board without refetching. The mutated
	 * fields come back from GitHub; dependency data is unaffected.
	 */
	function applyIssueUpdate(update: IssueUpdate): void {
		if (!data) return;
		const existing = findIssueIn(data, update.number);
		if (!existing) return;

		const merged: IssueRecord = { ...existing, ...update };
		const belongsInScope = data.scope === 'all' || merged.state === 'open';
		merged.inScope = belongsInScope;
		let issues: IssueRecord[];
		let referenced: IssueRecord[];

		if (belongsInScope) {
			issues = data.issues.some((issue) => issue.number === merged.number)
				? data.issues.map((issue) => (issue.number === merged.number ? merged : issue))
				: [...data.issues, merged];
			referenced = data.referencedIssues.filter((issue) => issue.number !== merged.number);
		} else {
			issues = data.issues.filter((issue) => issue.number !== merged.number);
			referenced = data.referencedIssues.some((issue) => issue.number === merged.number)
				? data.referencedIssues.map((issue) => (issue.number === merged.number ? merged : issue))
				: [...data.referencedIssues, merged];
		}

		const next: RepoData = { ...data, issues, referencedIssues: referenced };
		data = next;
		drawerIssue = merged;
		const auth = currentAuth();
		const key = cacheKeyFor(next, auth);
		writeSnapshot(key, buildSnapshot(next));
		writeRepoCache(key, next);
		clearOtherRepoEntries(owner, repo, auth, key);
		void rebuild();
	}

	async function handleSignOut(): Promise<void> {
		rebuildId += 1;
		data = null;
		nodes = [];
		edges = [];
		counts = null;
		selectedNumber = null;
		drawerIssue = null;
		drawerOpen = false;
		layoutRevision += 1;
		await load(scope);
	}

	function changeScope(value: FetchScope): void {
		scope = value;
	}

	function changeMilestone(value: string): void {
		milestone = value;
		void rebuild();
	}

	function changeIteration(value: string): void {
		iteration = value;
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
		{iteration}
		oniterationchange={changeIteration}
		{assignee}
		onassigneechange={changeAssignee}
		{hasOpenPR}
		onhasprchange={changeHasOpenPR}
		{options}
		{projectIterations}
		{counts}
		warnings={data?.meta.warnings ?? []}
		{loading}
		{refreshing}
		{progress}
		updatedAt={data?.meta.fetchedAt ?? null}
		{authNext}
		onrefresh={() => void refresh()}
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
				role="alert"
			>
				<p>{error.message}</p>
				<div class="mt-2 flex items-center gap-2">
					<button
						type="button"
						class="rounded-md border border-alert/25 px-2 py-1 text-xs text-[#a9272a] hover:bg-[#fff2f1]"
						onclick={retry}
					>
						Retry
					</button>
					{#if error.retry === 'refresh'}
						<button
							type="button"
							class="rounded-md border border-warm px-2 py-1 text-xs text-muted hover:bg-canvas"
							onclick={() => (error = null)}
						>
							Dismiss
						</button>
					{/if}
				</div>
			</div>
		{/if}

		<div class="board-notice-stack">
			<RefreshNotice
				{refreshing}
				{progress}
				diff={refreshNotice?.diff ?? null}
				checkedAt={refreshNotice?.checkedAt ?? null}
				note={refreshNotice?.note ?? null}
				ondismiss={() => (refreshNotice = null)}
			/>

			{#if !refreshing && !loading && counts && counts.issues === 0}
				<div
					class="rounded-full border border-warm bg-paper px-3 py-2 text-xs text-muted shadow-sm"
				>
					No issues match the current filters.
				</div>
			{/if}
		</div>

		{#if !loading && !error && counts && counts.edges === 0}
			<div
				class="board-hint-top absolute top-4 left-1/2 max-w-md -translate-x-1/2 rounded-lg border border-warm bg-paper/95 px-3 py-2 text-center text-xs text-muted shadow-sm"
			>
				No native blocking relationships in this view. Dependencies come from GitHub's issue
				Relationships attribute only.
			</div>
		{/if}
	</div>

	<IssueDrawer
		issue={drawerIssue}
		{data}
		open={drawerOpen}
		{owner}
		{repo}
		{authNext}
		onclose={closeDrawer}
		onupdated={applyIssueUpdate}
	/>
</div>

<style>
	.board-notice-stack {
		position: absolute;
		bottom: max(1.25rem, calc(env(safe-area-inset-bottom, 0px) + 0.75rem));
		left: 50%;
		z-index: 30;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		width: min(440px, calc(100vw - 2rem));
		transform: translateX(-50%);
		pointer-events: none;
	}

	.board-notice-stack > :global(*) {
		pointer-events: auto;
	}
</style>
