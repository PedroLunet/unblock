<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AuthControls from '#lib/auth/AuthControls.svelte';
	import logo from '#lib/assets/unblock-logo.svg';
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

<div class="page-safe-x mx-auto max-w-2xl py-12">
	<header class="flex items-start gap-3">
		<img src={logo} alt="" width="40" height="40" class="h-10 w-10 shrink-0" />
		<div class="flex flex-col gap-1.5">
			<h1 class="text-xl font-semibold tracking-[-0.02em] text-ink">unblock</h1>
			<p class="text-sm text-muted">GitHub issue &amp; dependency board</p>
			<p class="text-xs leading-relaxed text-quiet">
				Paste a public repository, or sign in with GitHub for private repos, higher rate limits, and
				issue editing.
			</p>
		</div>
	</header>

	<div class="mt-8 rounded-xl border border-warm bg-paper p-4 shadow-sm">
		<AuthControls next={authNext} showPrivateChoice showUnavailable />
		<p class="mt-3 text-xs leading-relaxed text-quiet">
			Public repositories work without signing in. Signing in raises the limit to 5,000
			requests/hour, enables complete dependency data, and lets you change assignees, labels,
			milestones, and issue state without leaving the board. Editing needs GitHub's
			<code class="font-mono text-[10px] text-muted">public_repo</code> scope (or
			<code class="font-mono text-[10px] text-muted">repo</code> for private repositories); reads alone
			request no scopes.
		</p>
	</div>

	<form
		class="mt-8 flex flex-col gap-5"
		onsubmit={(event) => {
			event.preventDefault();
			openBoard();
		}}
	>
		<div class="flex flex-col gap-1.5">
			<label
				for="repository"
				class="font-mono text-[9px] font-medium tracking-[0.1em] text-quiet uppercase"
			>
				repository
			</label>
			<input
				id="repository"
				type="text"
				class="touch-target min-w-64 flex-1 rounded-md border border-warm bg-paper px-3 py-2 text-sm text-ink shadow-sm placeholder:text-quiet focus:ring-2 focus:ring-brand/25 focus:outline-none"
				placeholder="github.com/owner/repo or owner/repo"
				inputmode="url"
				autocapitalize="none"
				autocomplete="off"
				autocorrect="off"
				spellcheck="false"
				enterkeyhint="go"
				bind:value={repoInput}
			/>
			{#if parsedInput}
				<p class="font-mono text-[10px] text-quiet">
					will open <span class="text-muted">{parsedInput.owner}/{parsedInput.repo}</span>
				</p>
			{:else if inputError}
				<p class="text-xs text-[#a9272a]">Enter owner/repo or a GitHub URL</p>
			{/if}
		</div>

		<div class="flex flex-wrap items-center gap-3">
			<div class="inline-flex rounded-lg border border-warm bg-[#ece6de] p-0.5 text-sm">
				<button
					type="button"
					class="touch-target rounded-[6px] px-3 py-1.5 transition-colors {scope === 'open'
						? 'bg-paper text-ink shadow-sm'
						: 'text-muted hover:text-ink'}"
					onclick={() => (scope = 'open')}
				>
					Open Only
				</button>
				<button
					type="button"
					class="touch-target rounded-[6px] px-3 py-1.5 transition-colors {scope === 'all'
						? 'bg-paper text-ink shadow-sm'
						: 'text-muted hover:text-ink'}"
					onclick={() => (scope = 'all')}
				>
					Show Everything
				</button>
			</div>
			<button
				type="submit"
				class="touch-target rounded-md bg-brand-strong px-3.5 py-2 text-sm font-medium text-paper shadow-sm transition-[background-color,transform] hover:bg-brand-deep active:scale-[0.98] disabled:bg-warm disabled:text-quiet disabled:shadow-none"
				disabled={!parsedInput}
			>
				Open board
			</button>
		</div>
	</form>

	<footer class="mt-10">
		<a class="text-xs font-medium text-brand-strong hover:underline" href={resolve('/debug')}>
			raw data check
		</a>
	</footer>
</div>
