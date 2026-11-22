<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { session } from '#lib/auth/session.svelte.ts';
	import { clearLegacyPat } from '#lib/github/storage.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	$effect(() => {
		clearLegacyPat();
		void session.ensure();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
