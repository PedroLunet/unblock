<script lang="ts">
	type IconName =
		| 'github'
		| 'circle-dot'
		| 'flag'
		| 'user'
		| 'git-pull-request'
		| 'refresh'
		| 'chart'
		| 'sliders'
		| 'chevron-right'
		| 'chevrons-left'
		| 'chevrons-right'
		| 'external'
		| 'check'
		| 'x'
		| 'settings'
		| 'alert';

	interface Props {
		name: IconName;
		size?: number;
		strokeWidth?: number;
		class?: string;
	}

	let { name, size = 18, strokeWidth = 1.75, class: className = '' }: Props = $props();
</script>

{#if name === 'github'}
	<svg
		class={className}
		width={size}
		height={size}
		viewBox="0 0 16 16"
		fill="currentColor"
		aria-hidden="true"
	>
		<path
			d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
		/>
	</svg>
{:else}
	<svg
		class={className}
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width={strokeWidth}
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		{#if name === 'circle-dot'}
			<circle cx="12" cy="12" r="9" />
			<circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
		{:else if name === 'flag'}
			<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
			<line x1="4" x2="4" y1="22" y2="15" />
		{:else if name === 'user'}
			<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
			<circle cx="12" cy="7" r="4" />
		{:else if name === 'git-pull-request'}
			<circle cx="18" cy="18" r="3" />
			<circle cx="6" cy="6" r="3" />
			<path d="M13 6h3a2 2 0 0 1 2 2v7" />
			<line x1="6" x2="6" y1="9" y2="21" />
		{:else if name === 'refresh'}
			<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
			<path d="M21 3v5h-5" />
			<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
			<path d="M8 16H3v5" />
		{:else if name === 'chart'}
			<path d="M3 3v16a2 2 0 0 0 2 2h16" />
			<path d="M18 17V9" />
			<path d="M13 17V5" />
			<path d="M8 17v-3" />
		{:else if name === 'sliders'}
			<line x1="21" x2="14" y1="4" y2="4" />
			<line x1="10" x2="3" y1="4" y2="4" />
			<line x1="21" x2="12" y1="12" y2="12" />
			<line x1="8" x2="3" y1="12" y2="12" />
			<line x1="21" x2="16" y1="20" y2="20" />
			<line x1="12" x2="3" y1="20" y2="20" />
			<line x1="14" x2="14" y1="2" y2="6" />
			<line x1="8" x2="8" y1="10" y2="14" />
			<line x1="16" x2="16" y1="18" y2="22" />
		{:else if name === 'chevron-right'}
			<path d="m9 18 6-6-6-6" />
		{:else if name === 'chevrons-left'}
			<path d="m11 17-5-5 5-5" />
			<path d="m18 17-5-5 5-5" />
		{:else if name === 'chevrons-right'}
			<path d="m6 17 5-5-5-5" />
			<path d="m13 17 5-5-5-5" />
		{:else if name === 'external'}
			<path d="M15 3h6v6" />
			<path d="M10 14 21 3" />
			<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
		{:else if name === 'check'}
			<path d="M20 6 9 17l-5-5" />
		{:else if name === 'x'}
			<path d="M18 6 6 18" />
			<path d="m6 6 12 12" />
		{:else if name === 'settings'}
			<path
				d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
			/>
			<circle cx="12" cy="12" r="3" />
		{:else if name === 'alert'}
			<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
			<path d="M12 9v4" />
			<path d="M12 17h.01" />
		{/if}
	</svg>
{/if}
