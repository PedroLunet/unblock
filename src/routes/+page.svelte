<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { clearPat, loadPat, maskPat, parseRepoInput, savePat } from '#lib/github';
	import type { FetchScope } from '#lib/github';

	let repoInput = $state('');
	let patInput = $state('');
	let storedPat = $state<string | null>(null);
	let scope = $state<FetchScope>('open');

	let trimmedRepoInput = $derived(repoInput.trim());
	let parsedInput = $derived(trimmedRepoInput === '' ? null : parseRepoInput(trimmedRepoInput));
	let inputError = $derived(trimmedRepoInput !== '' && parsedInput === null);

	// PAT initialization happens in the browser only ($effect never runs during SSR).
	// The stored token lives in `storedPat` and is never echoed back into the input.
	function refreshStoredPat(): void {
		storedPat = loadPat();
	}

	$effect(refreshStoredPat);

	function savePatFromInput(): void {
		savePat(patInput);
		patInput = '';
		refreshStoredPat();
	}

	function clearStoredPat(): void {
		clearPat();
		patInput = '';
		refreshStoredPat();
	}

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
			Paste a public repository, or add a read-only token for private repos and higher rate limits.
		</p>
	</header>

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

		<div class="flex flex-col gap-1">
			<div class="flex flex-wrap items-center gap-2">
				<input
					type="password"
					class="min-w-64 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
					placeholder="optional: GitHub PAT (read-only, stored locally)"
					aria-label="GitHub token"
					bind:value={patInput}
				/>
				<button
					type="button"
					class="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900"
					onclick={savePatFromInput}
				>
					Save PAT
				</button>
				{#if storedPat}
					<span
						class="rounded border border-neutral-300 bg-neutral-100 px-2 py-1 text-xs text-neutral-700"
					>
						PAT saved ({maskPat(storedPat)})
					</span>
					<button
						type="button"
						class="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900"
						onclick={clearStoredPat}
					>
						Clear
					</button>
				{/if}
			</div>
			<p class="text-xs text-neutral-500">
				Stored only in your browser's localStorage. Sent only to api.github.com.
			</p>
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
