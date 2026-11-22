<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AuthControls from '#lib/auth/AuthControls.svelte';
	import { parseRepoInput } from '#lib/github';
	import type { FetchScope } from '#lib/github';

	let repoInput = $state('');
	let scope = $state<FetchScope>('open');

	let trimmedRepoInput = $derived(repoInput.trim());
	let parsedInput = $derived(trimmedRepoInput === '' ? null : parseRepoInput(trimmedRepoInput));
	let inputError = $derived(trimmedRepoInput !== '' && parsedInput === null);
	let authNext = $derived(page.url.pathname + page.url.search);

	function openBoard(): void {
		const target = parsedInput;
		if (!target) return;
		void goto(
			resolve(`/[owner]/[repo]?scope=${scope}`, { owner: target.owner, repo: target.repo })
		);
	}
</script>

<div class="mx-auto max-w-2xl px-4 py-8">
	<header class="flex flex-col gap-1">
		<h1 class="text-lg font-bold text-neutral-900">unblock</h1>
		<p class="text-sm text-neutral-600">GitHub issue &amp; dependency board</p>
		<p class="text-xs text-neutral-500">
			Paste a public repository, or sign in with GitHub for private repos and higher rate limits.
		</p>
	</header>

	<div class="mt-6 rounded border border-neutral-300 bg-neutral-50 p-3">
		<AuthControls next={authNext} showPrivateChoice showUnavailable />
		<p class="mt-2 text-xs text-neutral-500">
			Public repositories work without signing in. Signing in raises the limit to 5,000
			requests/hour and enables complete dependency data. Private repositories require GitHub's
			broad <code>repo</code> scope (OAuth has no read-only private scope).
		</p>
	</div>

	<form
		class="mt-6 flex flex-col gap-4"
		onsubmit={(event) => {
			event.preventDefault();
			openBoard();
		}}
	>
		<div class="flex flex-col gap-1">
			<div class="flex flex-wrap gap-2">
				<input
					type="text"
					class="min-w-64 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
					placeholder="github.com/owner/repo or owner/repo"
					aria-label="Repository"
					bind:value={repoInput}
				/>
			</div>
			{#if parsedInput}
				<p class="text-xs text-neutral-500">Will open {parsedInput.owner}/{parsedInput.repo}</p>
			{:else if inputError}
				<p class="text-xs text-red-700">Enter owner/repo or a GitHub URL</p>
			{/if}
		</div>

		<div class="flex flex-wrap items-center gap-3">
			<div class="inline-flex overflow-hidden rounded border border-neutral-300 text-sm">
				<button
					type="button"
					class="border-r border-neutral-300 px-3 py-1.5 {scope === 'open'
						? 'bg-neutral-900 text-white'
						: 'bg-white text-neutral-900'}"
					onclick={() => (scope = 'open')}
				>
					Open Only
				</button>
				<button
					type="button"
					class="px-3 py-1.5 {scope === 'all'
						? 'bg-neutral-900 text-white'
						: 'bg-white text-neutral-900'}"
					onclick={() => (scope = 'all')}
				>
					Show Everything
				</button>
			</div>
			<button
				type="submit"
				class="rounded border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:border-neutral-300 disabled:bg-neutral-200 disabled:text-neutral-500"
				disabled={!parsedInput}
			>
				Open board
			</button>
		</div>
	</form>

	<footer class="mt-8">
		<a class="text-xs text-neutral-500 underline" href={resolve('/debug')}>raw data check</a>
	</footer>
</div>
