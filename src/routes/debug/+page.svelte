<script lang="ts">
	import { page } from '$app/state';
	import AuthControls from '#lib/auth/AuthControls.svelte';
	import { session } from '#lib/auth/session.svelte.ts';
	import { GithubError, loadRepo, parseRepoInput, resolveRef } from '#lib/github';
	import type { DependencyRef, FetchScope, LinkedPR, RepoData, RepoTarget } from '#lib/github';

	const RENDER_CAP = 200;

	let repoInput = $state('');
	let scope = $state<FetchScope>('open');
	let data = $state<RepoData | null>(null);
	let loading = $state(false);
	let progressMessage = $state('');
	let loadErrorMessage = $state<string | null>(null);

	let trimmedRepoInput = $derived(repoInput.trim());
	let parsedInput = $derived(trimmedRepoInput === '' ? null : parseRepoInput(trimmedRepoInput));
	let inputError = $derived(trimmedRepoInput !== '' && parsedInput === null);
	let authNext = $derived(page.url.pathname + page.url.search);
	let loadTarget = $derived.by(() => {
		if (parsedInput) return parsedInput;
		if (trimmedRepoInput === '' && data) return { owner: data.owner, repo: data.repo };
		return null;
	});
	let canLoad = $derived(!loading && loadTarget !== null);

	function setScope(next: FetchScope): void {
		if (loading || scope === next) return;
		scope = next;
		if (data) {
			// Reload the current board for the new scope; the data layer caches per scope.
			void loadBoard({ owner: data.owner, repo: data.repo }, next);
		}
	}

	function handleLoad(): void {
		if (loading) return;
		const target = loadTarget;
		if (!target) return;
		void loadBoard(target, scope);
	}

	function handleRefresh(): void {
		if (loading) return;
		const target = loadTarget;
		if (!target) return;
		void loadBoard(target, scope, { refresh: true });
	}

	async function loadBoard(
		target: RepoTarget,
		targetScope: FetchScope,
		options?: { refresh?: boolean }
	): Promise<void> {
		loading = true;
		loadErrorMessage = null;
		progressMessage = '';
		try {
			await session.ensure();
			data = await loadRepo(target.owner, target.repo, {
				auth: session.user ? 'github' : 'anonymous',
				scope: targetScope,
				refresh: options?.refresh === true,
				progress: (message) => {
					progressMessage = message;
				}
			});
		} catch (err) {
			if (err instanceof GithubError) {
				if (err.kind === 'auth') void session.refresh();
				loadErrorMessage = err.message;
			} else {
				console.error(err);
				loadErrorMessage = 'Something went wrong while loading the repository.';
			}
		} finally {
			loading = false;
		}
	}

	let allIssues = $derived(data ? [...data.issues, ...data.referencedIssues] : []);
	let renderedIssues = $derived(allIssues.slice(0, RENDER_CAP));
	let hiddenIssueCount = $derived(allIssues.length - renderedIssues.length);

	let stats = $derived.by(() => {
		if (!data) return [];
		const meta = data.meta;
		return [
			{ label: 'repository', value: meta.nameWithOwner ?? `${data.owner}/${data.repo}` },
			{ label: 'scope', value: meta.scope },
			{ label: 'source', value: meta.source === 'rest' ? 'REST' : 'GraphQL' },
			{
				label: 'issues loaded',
				value:
					meta.totalIssues !== null
						? `${data.issues.length} of ${meta.totalIssues}`
						: `${data.issues.length}`
			},
			{ label: 'referenced issues resolved', value: `${data.referencedIssues.length}` },
			{ label: 'dependency edges', value: `${data.edges.length}` },
			{ label: 'linked PRs', value: `${Object.keys(data.prs).length}` },
			{ label: 'API requests used', value: `${meta.requestCount}` },
			{
				label: 'rate limit remaining',
				value: meta.rateLimit ? `${meta.rateLimit.remaining}/${meta.rateLimit.limit}` : '—'
			},
			{ label: 'fetch duration', value: `${(meta.fetchDurationMs / 1000).toFixed(1)}s` },
			{ label: 'fetched at', value: new Date(meta.fetchedAt).toLocaleString() }
		];
	});

	// Serialized once per loaded dataset so nothing re-stringifies on every update.
	let rawJson = $derived(data ? JSON.stringify(data, null, 2) : '');

	function daysAgo(iso: string): number {
		return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
	}

	function refLabel(source: RepoData, ref: DependencyRef): string {
		const resolution = resolveRef(source, ref.number);
		switch (resolution.kind) {
			case 'issue':
				return `#${ref.number} (${resolution.issue.state})`;
			case 'pr':
				return `PR #${ref.number}`;
			default:
				return `#${ref.number} (missing)`;
		}
	}

	function prStatus(pr: LinkedPR): string {
		if (pr.draft === true) return 'DRAFT';
		if (pr.state === 'open') return 'OPEN';
		if (pr.state === 'merged') return 'MERGED';
		return 'CLOSED';
	}

	function prAuthor(pr: LinkedPR): string {
		return pr.author ? ` by @${pr.author}` : '';
	}
</script>

<div class="page-safe-x mx-auto max-w-5xl py-8">
	<header class="mb-6">
		<h1 class="text-lg font-bold text-neutral-900">unblock</h1>
		<p class="text-sm text-neutral-600">GitHub issue &amp; dependency board — Step 1 data check</p>
	</header>

	<section class="flex flex-col gap-3">
		<div class="flex flex-col gap-1">
			<div class="flex flex-wrap gap-2">
				<input
					type="text"
					class="min-w-64 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
					placeholder="github.com/owner/repo or owner/repo"
					bind:value={repoInput}
				/>
			</div>
			{#if parsedInput}
				<p class="text-xs text-neutral-500">Will load {parsedInput.owner}/{parsedInput.repo}</p>
			{:else if inputError}
				<p class="text-xs text-red-700">Enter owner/repo or a GitHub URL</p>
			{/if}
		</div>

		<div class="flex flex-col gap-1">
			<AuthControls
				next={authNext}
				showPrivateChoice
				onsignout={() => {
					data = null;
					loadErrorMessage = null;
				}}
			/>
			<p class="text-xs text-neutral-500">
				Sign in for private repositories, 5,000 requests/hour, and complete dependency data.
			</p>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<div class="inline-flex overflow-hidden rounded border border-neutral-300 text-sm">
				<button
					type="button"
					class="border-r border-neutral-300 px-3 py-1.5 {scope === 'open'
						? 'bg-neutral-900 text-white'
						: 'bg-white text-neutral-900'}"
					onclick={() => setScope('open')}
				>
					Open Only
				</button>
				<button
					type="button"
					class="px-3 py-1.5 {scope === 'open'
						? 'bg-white text-neutral-900'
						: 'bg-neutral-900 text-white'}"
					onclick={() => setScope('all')}
				>
					Show Everything
				</button>
			</div>
			<button
				type="button"
				class="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 disabled:text-neutral-400"
				disabled={!canLoad}
				onclick={handleLoad}
			>
				Load board
			</button>
			{#if data}
				<button
					type="button"
					class="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 disabled:text-neutral-400"
					disabled={!canLoad}
					onclick={handleRefresh}
				>
					Refresh
				</button>
			{/if}
		</div>

		{#if loading}
			<p class="text-sm text-neutral-500">{progressMessage || 'Loading…'}</p>
		{/if}

		{#if loadErrorMessage}
			<div class="rounded border border-red-600 bg-red-50 p-3 text-sm text-red-700">
				{loadErrorMessage}
			</div>
		{/if}
	</section>

	{#if data}
		<section class="mt-8 flex flex-col gap-3">
			<div
				class="grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-300 bg-neutral-300 sm:grid-cols-3 lg:grid-cols-4"
			>
				{#each stats as stat (stat.label)}
					<div class="bg-white p-2">
						<p class="text-xs text-neutral-500">{stat.label}</p>
						<p class="text-sm text-neutral-900">{stat.value}</p>
					</div>
				{/each}
				{#if data.meta.fromCache}
					<div class="flex items-center bg-white p-2">
						<span class="rounded border border-neutral-400 px-1 py-0.5 text-xs text-neutral-600">
							cached
						</span>
					</div>
				{/if}
			</div>

			{#if data.meta.warnings.length > 0}
				<ul
					class="list-inside list-disc rounded border border-amber-500 bg-amber-50 p-3 text-sm text-amber-800"
				>
					{#each data.meta.warnings as warning, i (i)}
						<li>{warning}</li>
					{/each}
				</ul>
			{/if}

			<p class="text-xs text-neutral-500">PR link detection: {data.meta.prLinkDetection}</p>
			<p class="text-xs text-neutral-500">Native relationships: {data.meta.nativeRelationships}</p>

			{#if hiddenIssueCount > 0}
				<p class="text-xs text-neutral-500">
					Showing first {renderedIssues.length} of {allIssues.length} issues — the full data is in the
					raw JSON below.
				</p>
			{/if}

			<div class="flex flex-col gap-2">
				{#each renderedIssues as issue (issue.number)}
					<article class="rounded border border-neutral-300 p-3 text-sm">
						<div class="flex flex-wrap items-baseline gap-x-2">
							<span class="font-mono text-xs text-neutral-700">#{issue.number}</span>
							<span
								class="rounded border px-1 text-xs {issue.state === 'open'
									? 'border-green-600 text-green-700'
									: 'border-neutral-500 text-neutral-500'}"
							>
								{issue.state}
							</span>
							<a href={issue.url} rel="external" class="font-medium text-neutral-900 underline">
								{issue.title}
							</a>
							{#if !issue.inScope}
								<span class="text-xs text-neutral-500">· referenced</span>
							{/if}
						</div>

						<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600">
							{#if issue.assignees.length > 0}
								<span>{issue.assignees.map((assignee) => assignee.login).join(', ')}</span>
							{:else}
								<span class="rounded border border-neutral-400 px-1 font-bold">Unassigned</span>
							{/if}
							<span>{issue.milestone ? issue.milestone.title : 'no milestone'}</span>
							<span>
								{issue.iterations.length > 0
									? issue.iterations.map((iteration) => iteration.title).join(', ')
									: 'no iteration'}
							</span>
							{#each issue.labels as label (label.name)}
								<span class="rounded border border-neutral-400 px-1">{label.name}</span>
							{/each}
							{#if issue.reactions === null}
								<span>reactions ?</span>
							{:else}
								<span>reactions {issue.reactions.total}</span>
							{/if}
							<span>comments {issue.comments}</span>
							<span>age {daysAgo(issue.createdAt)}d</span>
							<span>updated {daysAgo(issue.updatedAt)}d ago</span>
							{#if issue.prScan !== 'full'}
								<span>PR scan: {issue.prScan}</span>
							{/if}
						</div>

						<div class="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-neutral-700">
							<span class="text-neutral-500">blocked by:</span>
							{#if issue.blockedBy.length === 0}
								<span class="text-neutral-500">—</span>
							{:else}
								{#each issue.blockedBy as ref (ref.number)}
									<span>
										{refLabel(data, ref)} <span class="text-neutral-500">{ref.source}</span>
									</span>
								{/each}
							{/if}
						</div>

						<div class="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-neutral-700">
							<span class="text-neutral-500">blocks:</span>
							{#if issue.blocks.length === 0}
								<span class="text-neutral-500">—</span>
							{:else}
								{#each issue.blocks as ref (ref.number)}
									<span>
										{refLabel(data, ref)} <span class="text-neutral-500">{ref.source}</span>
									</span>
								{/each}
							{/if}
						</div>

						<div class="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-neutral-700">
							<span class="text-neutral-500">linked PRs:</span>
							{#if issue.linkedPRs.length === 0}
								<span class="text-neutral-500">—</span>
							{:else}
								{#each issue.linkedPRs as pr (pr.number)}
									<span>
										<a href={pr.url} rel="external" class="underline">
											{prStatus(pr)} PR #{pr.number}{prAuthor(pr)}
										</a>
										{#if pr.mergeStateUnknown}
											<span class="text-neutral-500"> (merge state unknown)</span>
										{/if}
										{#if pr.crossRepository === true}
											<span class="text-neutral-500"> (cross-repo)</span>
										{/if}
									</span>
								{/each}
							{/if}
						</div>
					</article>
				{/each}
			</div>

			<details class="rounded border border-neutral-300 p-3">
				<summary class="cursor-pointer text-sm text-neutral-700">raw JSON</summary>
				<pre class="mt-2 overflow-x-auto font-mono text-xs text-neutral-800">{rawJson}</pre>
			</details>
		</section>
	{/if}
</div>
