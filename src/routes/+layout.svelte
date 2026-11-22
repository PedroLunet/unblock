<script lang="ts">
	import '@fontsource/dm-sans/latin-400.css';
	import '@fontsource/dm-sans/latin-500.css';
	import '@fontsource/dm-sans/latin-600.css';
	import '@fontsource/dm-mono/latin-400.css';
	import '@fontsource/dm-mono/latin-500.css';
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
