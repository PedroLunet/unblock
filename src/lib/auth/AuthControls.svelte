<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { session } from './session.svelte';

	interface Props {
		/** Where GitHub should send the user after signing in. */
		next: string;
		/** Show the private-repository opt-in. */
		showPrivateChoice?: boolean;
		/** Show a note when this deployment has no OAuth credentials. */
		showUnavailable?: boolean;
		/** Called after the session has been cleared. */
		onsignout?: () => void;
	}

	let { next, showPrivateChoice = false, showUnavailable = false, onsignout }: Props = $props();

	let includePrivate = $state(false);
	let signingOut = $state(false);

	// Strip stale auth-result params so a successful retry doesn't keep the error banner.
	function cleanNext(value: string): string {
		const url = new URL(value, 'https://unblock.invalid');
		url.searchParams.delete('auth');
		url.searchParams.delete('reason');
		return url.pathname + url.search + url.hash;
	}

	let target = $derived(cleanNext(next));
	let hasPrivateAccess = $derived(session.user?.scopes.includes('repo') ?? false);

	let authError = $derived(page.url.searchParams.get('auth') === 'error');
	let authErrorReason = $derived(page.url.searchParams.get('reason') ?? '');
	let authErrorMessage = $derived.by(() => {
		switch (authErrorReason) {
			case 'access_denied':
				return 'GitHub sign-in was cancelled.';
			case 'invalid_state':
				return 'GitHub sign-in expired. Try again.';
			case 'exchange_failed':
				return 'GitHub could not complete sign-in. Try again.';
			default:
				return "GitHub sign-in didn't complete. Try again.";
		}
	});

	async function handleSignOut(): Promise<void> {
		if (signingOut) return;
		signingOut = true;
		try {
			await session.signOut();
			onsignout?.();
		} finally {
			signingOut = false;
		}
	}
</script>

<div class="flex flex-col gap-2">
	<div class="flex flex-wrap items-center gap-2 text-xs">
		{#if session.user}
			{#if session.user.avatarUrl}
				<img
					src={session.user.avatarUrl}
					alt=""
					class="h-5 w-5 rounded-full"
					referrerpolicy="no-referrer"
				/>
			{/if}
			<span class="text-muted">
				Signed in as <span class="font-medium text-ink">@{session.user.login}</span>
			</span>
			{#if hasPrivateAccess}
				<span
					class="rounded-[5px] border border-warm bg-canvas px-1.5 py-0.5 font-mono text-[9px] tracking-[0.04em] text-muted"
				>
					private access
				</span>
			{:else if showPrivateChoice}
				<form method="GET" action={resolve('/auth/github/start')} class="inline-flex">
					<input type="hidden" name="next" value={target} />
					<input type="hidden" name="private" value="1" />
					<button type="submit" class="text-xs font-medium text-brand-strong hover:underline">
						Enable private repos
					</button>
				</form>
			{/if}
			<button
				type="button"
				class="rounded-md border border-warm bg-paper px-2 py-1 text-xs text-ink hover:bg-canvas disabled:text-quiet"
				disabled={signingOut}
				onclick={() => void handleSignOut()}
			>
				{signingOut ? 'Signing out…' : 'Sign out'}
			</button>
		{:else if session.loading}
			<span class="text-quiet">Checking GitHub session…</span>
		{:else if !session.configured}
			{#if showUnavailable}
				<span class="text-quiet">GitHub sign-in is not configured on this deployment.</span>
			{/if}
		{:else}
			{#if showPrivateChoice}
				<label class="flex items-center gap-1.5 text-muted">
					<input type="checkbox" class="accent-brand" bind:checked={includePrivate} />
					Include private repositories
				</label>
			{/if}
			<form method="GET" action={resolve('/auth/github/start')} class="inline-flex">
				<input type="hidden" name="next" value={target} />
				{#if includePrivate}
					<input type="hidden" name="private" value="1" />
				{/if}
				<button
					type="submit"
					class="rounded-md bg-brand-strong px-2.5 py-1 text-xs font-medium text-paper shadow-sm hover:bg-brand-deep"
				>
					Sign in with GitHub
				</button>
			</form>
		{/if}
	</div>

	{#if authError}
		<p class="text-xs text-[#a9272a]" role="alert">{authErrorMessage}</p>
	{/if}
</div>
