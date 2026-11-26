<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Ring } from 'loadsv';
	import { cleanNext } from './next';
	import { canReadProjects, canWriteIssues, session } from './session.svelte';

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
	let allowEditing = $state(true);
	let includeProjects = $state(false);
	let signingOut = $state(false);

	let target = $derived(cleanNext(next));
	let hasPrivateAccess = $derived(session.user?.scopes.includes('repo') ?? false);
	let hasWriteAccess = $derived(session.user ? canWriteIssues(session.user.scopes) : false);
	let hasProjectAccess = $derived(session.user ? canReadProjects(session.user.scopes) : false);

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
			{#if hasWriteAccess}
				<span
					class="rounded-[5px] border border-brand/30 bg-brand/5 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.04em] text-brand-deep"
				>
					can edit
				</span>
			{:else}
				<span
					class="rounded-[5px] border border-warm bg-canvas px-1.5 py-0.5 font-mono text-[9px] tracking-[0.04em] text-quiet"
				>
					read-only
				</span>
				<form method="GET" action={resolve('/auth/github/start')} class="inline-flex">
					<input type="hidden" name="next" value={target} />
					<input type="hidden" name="write" value="1" />
					<button type="submit" class="text-xs font-medium text-brand-strong hover:underline">
						Enable editing
					</button>
				</form>
			{/if}
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
					{#if allowEditing}
						<input type="hidden" name="write" value="1" />
					{/if}
					<button type="submit" class="text-xs font-medium text-brand-strong hover:underline">
						Enable private repos
					</button>
				</form>
			{/if}
			{#if hasProjectAccess}
				<span
					class="rounded-[5px] border border-warm bg-canvas px-1.5 py-0.5 font-mono text-[9px] tracking-[0.04em] text-muted"
				>
					iterations
				</span>
			{:else}
				<form method="GET" action={resolve('/auth/github/start')} class="inline-flex">
					<input type="hidden" name="next" value={target} />
					<input type="hidden" name="projects" value="1" />
					<button type="submit" class="text-xs font-medium text-brand-strong hover:underline">
						Enable iterations
					</button>
				</form>
			{/if}
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-md border border-warm bg-paper px-2 py-1 text-xs text-ink hover:bg-canvas disabled:text-quiet"
				disabled={signingOut}
				aria-busy={signingOut}
				onclick={() => void handleSignOut()}
			>
				{#if signingOut}<Ring size={11} />{/if}
				{signingOut ? 'Signing out…' : 'Sign out'}
			</button>
		{:else if session.loading}
			<span class="inline-flex items-center gap-1.5 text-quiet">
				<Ring size={12} />
				Checking GitHub session…
			</span>
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
			{#if includePrivate}
				<span class="text-quiet">Editing is included with private-repository access.</span>
			{:else}
				<label class="flex items-center gap-1.5 text-muted">
					<input type="checkbox" class="accent-brand" bind:checked={allowEditing} />
					Allow editing issues
				</label>
			{/if}
			<label class="flex items-center gap-1.5 text-muted">
				<input type="checkbox" class="accent-brand" bind:checked={includeProjects} />
				Show project iterations
			</label>
			<form method="GET" action={resolve('/auth/github/start')} class="inline-flex">
				<input type="hidden" name="next" value={target} />
				{#if includePrivate}
					<input type="hidden" name="private" value="1" />
				{/if}
				{#if allowEditing && !includePrivate}
					<input type="hidden" name="write" value="1" />
				{/if}
				{#if includeProjects}
					<input type="hidden" name="projects" value="1" />
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

<style>
	@media (pointer: coarse) {
		/* Make the whole checkbox label a comfortable tap target. */
		label {
			min-height: 44px;
		}

		button {
			min-height: 44px;
		}
	}
</style>
