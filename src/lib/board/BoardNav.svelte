<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { MediaQuery } from 'svelte/reactivity';
	import { fade } from 'svelte/transition';
	import type { TransitionConfig } from 'svelte/transition';
	import { resolve } from '$app/paths';
	import AuthControls from '#lib/auth/AuthControls.svelte';
	import { session } from '#lib/auth/session.svelte.ts';
	import mark from '#lib/assets/unblock-mark.svg';
	import type { BoardCounts, FilterOptions } from '#lib/board/graph.ts';
	import type { FetchScope } from '#lib/github';
	import Icon from '#lib/ui/Icon.svelte';

	type MenuId = 'scope' | 'milestone' | 'assignee' | 'stats' | 'account';

	interface Props {
		owner: string;
		repo: string;
		scope: FetchScope;
		milestone: string;
		assignee: string;
		hasOpenPR: boolean;
		options: FilterOptions;
		counts: BoardCounts | null;
		warnings: string[];
		loading: boolean;
		refreshing: boolean;
		progress: string;
		updatedAt: string | null;
		authNext: string;
		onscopechange: (scope: FetchScope) => void;
		onmilestonechange: (value: string) => void;
		onassigneechange: (value: string) => void;
		onhasprchange: (value: boolean) => void;
		onrefresh: () => void;
		onsignout: () => void | Promise<void>;
	}

	let {
		owner,
		repo,
		scope,
		milestone,
		assignee,
		hasOpenPR,
		options,
		counts,
		warnings,
		loading,
		refreshing,
		progress,
		updatedAt,
		authNext,
		onscopechange,
		onmilestonechange,
		onassigneechange,
		onhasprchange,
		onrefresh,
		onsignout
	}: Props = $props();

	const EXPANDED_KEY = 'unblock:rail-expanded';
	const MENU_GAP = 10;
	const VIEWPORT_PAD = 12;
	const TIP_DELAY = 320;
	const FOCUSABLE =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
	const motion = new MediaQuery('(prefers-reduced-motion: reduce)', false);
	const compact = new MediaQuery('(max-width: 767px), (max-height: 540px)', false);
	const updatedTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
	const updatedDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
	let isMobile = $derived(compact.current);

	let expanded = $state(false);
	let menu = $state<MenuId | null>(null);
	let shownMenu = $state<MenuId | null>(null);
	let menuTrigger = $state<HTMLElement | null>(null);
	let menuEl = $state<HTMLElement | null>(null);
	let menuStyle = $state('left:-9999px;top:-9999px;');
	let railEl = $state<HTMLElement | null>(null);
	let controlsEl = $state<HTMLButtonElement | null>(null);
	let tipsWarm = $state(false);
	let tipsTimer: number | null = null;

	onMount(() => {
		try {
			expanded = !compact.current && localStorage.getItem(EXPANDED_KEY) === '1';
		} catch {
			expanded = false;
		}
	});

	onDestroy(() => {
		if (tipsTimer !== null) window.clearTimeout(tipsTimer);
	});

	/** After the first tooltip has had time to open, show its neighbours at once. */
	function warmTips(event: PointerEvent): void {
		if (tipsTimer !== null || event.pointerType === 'touch') return;
		tipsTimer = window.setTimeout(() => {
			tipsWarm = true;
			tipsTimer = null;
		}, TIP_DELAY);
	}

	function coolTips(): void {
		if (tipsTimer !== null) {
			window.clearTimeout(tipsTimer);
			tipsTimer = null;
		}
		tipsWarm = false;
	}

	let wasMobile = false;
	$effect(() => {
		if (isMobile && !wasMobile) expanded = false;
		wasMobile = isMobile;
	});

	function labelFor(
		value: string,
		list: { value: string; label: string }[],
		allLabel: string
	): string {
		if (value === 'all') return allLabel;
		return list.find((option) => option.value === value)?.label ?? value;
	}

	function formatUpdated(iso: string): string {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return '';
		const now = new Date();
		return date.toDateString() === now.toDateString()
			? updatedTime.format(date)
			: updatedDate.format(date);
	}

	let scopeValue = $derived(scope === 'open' ? 'Open only' : 'All issues');
	let milestoneValue = $derived(labelFor(milestone, options.milestones, 'All milestones'));
	let assigneeValue = $derived(labelFor(assignee, options.assignees, 'All assignees'));
	let statsValue = $derived(
		loading
			? progress || 'Loading repository…'
			: counts
				? `${counts.issues} issues${warnings.length > 0 ? ` · ${warnings.length} notes` : ''}`
				: 'No data yet'
	);
	let accountValue = $derived(
		session.user
			? `@${session.user.login}`
			: session.loading
				? 'Checking session…'
				: session.configured
					? 'Sign in with GitHub'
					: 'Sign-in unavailable'
	);
	let refreshValue = $derived.by(() => {
		if (loading) return 'Waiting for board';
		if (refreshing) return progress || 'Checking GitHub…';
		if (updatedAt) return `Updated ${formatUpdated(updatedAt)}`;
		return 'Fetch from GitHub';
	});
	let refreshTip = $derived.by(() => {
		if (loading) return 'Refresh will be available once the board has loaded';
		if (refreshing) return progress || 'Checking GitHub for updates…';
		return `Refresh data from GitHub${
			updatedAt ? ` · last fetched ${formatUpdated(updatedAt)}` : ''
		}`;
	});
	let filtersActive = $derived(
		scope !== 'open' || milestone !== 'all' || assignee !== 'all' || hasOpenPR
	);
	let menuTitle = $derived.by(() => {
		switch (shownMenu) {
			case 'scope':
				return 'Scope';
			case 'milestone':
				return 'Milestone';
			case 'assignee':
				return 'Assignee';
			case 'stats':
				return 'Board data';
			case 'account':
				return 'GitHub account';
			default:
				return 'Menu';
		}
	});

	interface PopParams {
		mobile: boolean;
	}

	function popIn(node: Element, params: PopParams): TransitionConfig {
		if (node instanceof HTMLElement) {
			node.style.transformOrigin = params.mobile ? 'center bottom' : 'left center';
		}

		return {
			duration: motion.current ? 0 : params.mobile ? 240 : 160,
			easing: cubicOut,
			css: (t) =>
				params.mobile
					? `opacity:${t};transform:translateY(${14 * (1 - t)}px)`
					: `opacity:${t};transform:scale(${0.96 + 0.04 * t})`
		};
	}

	function popOut(node: Element, params: PopParams): TransitionConfig {
		if (node instanceof HTMLElement) {
			node.style.transformOrigin = params.mobile ? 'center bottom' : 'left center';
		}

		return {
			duration: motion.current ? 0 : params.mobile ? 170 : 110,
			easing: cubicOut,
			css: (t) =>
				params.mobile
					? `opacity:${t};transform:translateY(${10 * (1 - t)}px)`
					: `opacity:${t};transform:scale(${0.98 + 0.02 * t})`
		};
	}

	function toggleExpanded(): void {
		closeMenu(false);
		expanded = !expanded;
		if (isMobile) return;
		try {
			localStorage.setItem(EXPANDED_KEY, expanded ? '1' : '0');
		} catch {
			// Ignore storage failures (private mode, quota).
		}
	}

	function toggleMenu(id: MenuId, trigger: HTMLElement): void {
		if (menu === id) {
			closeMenu();
			return;
		}

		if (menu === null) {
			menuEl = null;
			menuStyle = 'left:-9999px;top:-9999px;';
		}

		shownMenu = id;
		menuTrigger = trigger;
		menu = id;
	}

	function closeMenu(restoreFocus = true): void {
		const trigger = menuTrigger;
		menu = null;
		menuTrigger = null;
		if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
	}

	function chooseScope(value: FetchScope): void {
		onscopechange(value);
		closeMenu();
	}

	function chooseMilestone(value: string): void {
		onmilestonechange(value);
		closeMenu();
	}

	function chooseAssignee(value: string): void {
		onassigneechange(value);
		closeMenu();
	}

	function handleSignedOut(): void {
		closeMenu(false);
		void onsignout();
	}

	function positionMenu(): void {
		if (isMobile) return;
		if (!menuTrigger || !menuEl) return;

		const triggerRect = menuTrigger.getBoundingClientRect();
		const width = menuEl.offsetWidth;
		const height = menuEl.offsetHeight;
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const left = Math.max(
			VIEWPORT_PAD,
			Math.min(triggerRect.right + MENU_GAP, viewportWidth - width - VIEWPORT_PAD)
		);
		const centeredTop = triggerRect.top + triggerRect.height / 2 - height / 2;
		const top = Math.max(
			VIEWPORT_PAD,
			Math.min(centeredTop, viewportHeight - height - VIEWPORT_PAD)
		);

		menuStyle = `left:${Math.round(left)}px;top:${Math.round(top)}px;`;
	}

	function handlePointerDown(event: PointerEvent): void {
		if (menu === null) return;
		const target = event.target;
		if (!(target instanceof Node)) return;
		if (railEl?.contains(target) || menuEl?.contains(target)) return;
		closeMenu(false);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (menu === null) {
			if (isMobile && expanded && event.key === 'Escape') {
				event.preventDefault();
				expanded = false;
				controlsEl?.focus({ preventScroll: true });
			}
			return;
		}

		if (event.key === 'Escape') {
			event.preventDefault();
			closeMenu();
			return;
		}

		if (event.key === 'Tab' && isMobile) trapFocus(event);
	}

	function trapFocus(event: KeyboardEvent): void {
		if (!menuEl) return;

		const focusables = Array.from(menuEl.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
			(element) => element.getClientRects().length > 0
		);

		if (focusables.length === 0) {
			event.preventDefault();
			menuEl.focus({ preventScroll: true });
			return;
		}

		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		const active = document.activeElement;

		if (event.shiftKey) {
			if (active === first || active === menuEl || !menuEl.contains(active)) {
				event.preventDefault();
				last.focus();
			}
			return;
		}

		if (active === last || active === menuEl || !menuEl.contains(active)) {
			event.preventDefault();
			first.focus();
		}
	}

	function handleFocusIn(event: FocusEvent): void {
		if (menu === null) return;
		const target = event.target;
		if (!(target instanceof Node)) return;
		if (railEl?.contains(target) || menuEl?.contains(target)) return;
		closeMenu(false);
	}

	function handleResize(): void {
		if (menu !== null) positionMenu();
	}

	$effect(() => {
		const current = menu;
		const mobile = isMobile;
		if (current === null) return;

		void tick().then(() => {
			if (menu !== current || !menuEl) return;
			if (!mobile) positionMenu();
			menuEl.focus({ preventScroll: true });
		});
	});
</script>

<nav
	bind:this={railEl}
	class="rail"
	class:is-expanded={expanded}
	class:has-menu={menu !== null}
	class:tips-warm={tipsWarm}
	data-expanded={expanded}
	aria-label="Board controls"
	onpointerenter={warmTips}
	onpointerleave={coolTips}
>
	<div class="rail-head">
		<a
			class="rail-item rail-brand"
			href={resolve('/')}
			aria-label="unblock home"
			data-tip="Back to unblock"
		>
			<span class="brand-mark" aria-hidden="true">
				<img src={mark} alt="" width="24" height="24" draggable="false" />
				{#if loading}
					<span class="loading-dot"></span>
				{/if}
			</span>
			<span class="rail-copy" aria-hidden={!expanded}>
				<span class="brand-title">unblock</span>
				<span class="brand-sub" title={loading ? progress : undefined}>
					{loading ? progress || 'Loading repository…' : 'dependency board'}
				</span>
			</span>
		</a>

		<a
			class="rail-item"
			href={`https://github.com/${owner}/${repo}`}
			target="_blank"
			rel="external noreferrer"
			aria-label={`Open ${owner}/${repo} on GitHub`}
			data-tip={`${owner}/${repo} on GitHub`}
		>
			<span class="rail-icon">
				<Icon name="github" size={17} />
			</span>
			<span class="rail-copy" aria-hidden={!expanded}>
				<span class="rail-label">Repository</span>
				<span class="rail-value">{owner}/{repo}</span>
			</span>
			<span class="rail-trailing"><Icon name="external" size={13} /></span>
		</a>
	</div>

	<div class="rail-sections" id="board-controls-panel" inert={isMobile && !expanded}>
		<div class="rail-sections-inner">
			<div class="rail-group">
				<div class="rail-rule">
					<span class="rail-section" aria-hidden={!expanded}>Filters</span>
				</div>

				<button
					type="button"
					class="rail-item"
					class:is-open={menu === 'scope'}
					aria-haspopup="dialog"
					aria-expanded={menu === 'scope'}
					aria-label={`Issues shown: ${scopeValue}. Change scope`}
					data-tip={`Scope · ${scopeValue}`}
					onclick={(event) => toggleMenu('scope', event.currentTarget)}
				>
					<span class="rail-icon">
						<Icon name="circle-dot" />
						<span class="rail-dot" class:is-on={scope === 'all'}></span>
					</span>
					<span class="rail-copy" aria-hidden={!expanded}>
						<span class="rail-label">Scope</span>
						<span class="rail-value">{scopeValue}</span>
					</span>
					<span class="rail-trailing"><Icon name="chevron-right" size={14} /></span>
				</button>

				<button
					type="button"
					class="rail-item"
					class:is-open={menu === 'milestone'}
					aria-haspopup="dialog"
					aria-expanded={menu === 'milestone'}
					aria-label={`Milestone: ${milestoneValue}. Change milestone filter`}
					data-tip={`Milestone · ${milestoneValue}`}
					onclick={(event) => toggleMenu('milestone', event.currentTarget)}
				>
					<span class="rail-icon">
						<Icon name="flag" />
						<span class="rail-dot" class:is-on={milestone !== 'all'}></span>
					</span>
					<span class="rail-copy" aria-hidden={!expanded}>
						<span class="rail-label">Milestone</span>
						<span class="rail-value">{milestoneValue}</span>
					</span>
					<span class="rail-trailing"><Icon name="chevron-right" size={14} /></span>
				</button>

				<button
					type="button"
					class="rail-item"
					class:is-open={menu === 'assignee'}
					aria-haspopup="dialog"
					aria-expanded={menu === 'assignee'}
					aria-label={`Assignee: ${assigneeValue}. Change assignee filter`}
					data-tip={`Assignee · ${assigneeValue}`}
					onclick={(event) => toggleMenu('assignee', event.currentTarget)}
				>
					<span class="rail-icon">
						<Icon name="user" />
						<span class="rail-dot" class:is-on={assignee !== 'all'}></span>
					</span>
					<span class="rail-copy" aria-hidden={!expanded}>
						<span class="rail-label">Assignee</span>
						<span class="rail-value">{assigneeValue}</span>
					</span>
					<span class="rail-trailing"><Icon name="chevron-right" size={14} /></span>
				</button>

				<button
					type="button"
					class="rail-item"
					aria-pressed={hasOpenPR}
					aria-label={`Only issues with open pull requests: ${hasOpenPR ? 'on' : 'off'}`}
					data-tip={`Pull requests · ${hasOpenPR ? 'only open' : 'any state'}`}
					onclick={() => onhasprchange(!hasOpenPR)}
				>
					<span class="rail-icon">
						<Icon name="git-pull-request" />
						<span class="rail-dot" class:is-on={hasOpenPR}></span>
					</span>
					<span class="rail-copy" aria-hidden={!expanded}>
						<span class="rail-label">Pull requests</span>
						<span class="rail-value">
							{hasOpenPR ? 'Only open PRs' : 'Any state'}
						</span>
					</span>
					<span class="rail-switch" class:is-on={hasOpenPR} aria-hidden="true">
						<span></span>
					</span>
				</button>
			</div>

			<div class="rail-group">
				<div class="rail-rule">
					<span class="rail-section" aria-hidden={!expanded}>Actions</span>
				</div>

				<button
					type="button"
					class="rail-item"
					class:is-busy={refreshing}
					aria-busy={refreshing}
					aria-label={refreshing
						? 'Refreshing board data from GitHub'
						: 'Refresh board data from GitHub'}
					data-tip={refreshTip}
					disabled={loading || refreshing}
					onclick={onrefresh}
				>
					<span class="rail-icon">
						<Icon name="refresh" />
					</span>
					<span class="rail-copy" aria-hidden={!expanded}>
						<span class="rail-label">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
						<span class="rail-value">{refreshValue}</span>
					</span>
				</button>
			</div>
		</div>
	</div>

	<div class="rail-foot">
		<div class="rail-divider rail-divider-foot" aria-hidden="true"></div>

		<button
			type="button"
			class="rail-item"
			class:is-open={menu === 'stats'}
			aria-haspopup="dialog"
			aria-expanded={menu === 'stats'}
			aria-label={`Board data. ${statsValue}`}
			data-tip={`Board data · ${statsValue}`}
			onclick={(event) => toggleMenu('stats', event.currentTarget)}
		>
			<span class="rail-icon">
				<Icon name="chart" />
				{#if warnings.length > 0}
					<span class="rail-dot is-warning is-on"></span>
				{/if}
			</span>
			<span class="rail-copy" aria-hidden={!expanded}>
				<span class="rail-label">Board data</span>
				<span class="rail-value">{statsValue}</span>
			</span>
			<span class="rail-trailing"><Icon name="chevron-right" size={14} /></span>
		</button>

		<button
			type="button"
			class="rail-item"
			class:is-open={menu === 'account'}
			aria-haspopup="dialog"
			aria-expanded={menu === 'account'}
			aria-label={`GitHub account. ${accountValue}`}
			data-tip={`GitHub account · ${accountValue}`}
			onclick={(event) => toggleMenu('account', event.currentTarget)}
		>
			{#if session.loading}
				<span class="rail-icon">
					<span class="avatar-skeleton" aria-hidden="true"></span>
				</span>
			{:else if session.user?.avatarUrl}
				<img class="rail-avatar" src={session.user.avatarUrl} alt="" referrerpolicy="no-referrer" />
			{:else}
				<span class="rail-icon">
					<Icon name="user" />
				</span>
			{/if}
			<span class="rail-copy" aria-hidden={!expanded}>
				<span class="rail-label">Account</span>
				<span class="rail-value">{accountValue}</span>
			</span>
			<span class="rail-trailing"><Icon name="chevron-right" size={14} /></span>
		</button>

		<button
			type="button"
			class="rail-item"
			class:is-open={expanded}
			bind:this={controlsEl}
			aria-expanded={expanded}
			aria-controls={isMobile ? 'board-controls-panel' : undefined}
			aria-label={isMobile
				? expanded
					? 'Close board controls'
					: 'Open board controls'
				: expanded
					? 'Collapse sidebar'
					: 'Expand sidebar'}
			data-tip={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
			onclick={toggleExpanded}
		>
			<span class="rail-icon">
				<svg
					class="panel-icon"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
					<line class="panel-icon-bar" x1="8.5" y1="8" x2="8.5" y2="16" />
				</svg>
				{#if isMobile && filtersActive}
					<span class="rail-dot is-on"></span>
				{/if}
			</span>
			<span class="rail-copy" aria-hidden={!expanded}>
				<span class="rail-label">Collapse</span>
				<span class="rail-value">Hide the labels</span>
			</span>
		</button>
	</div>
</nav>

{#if isMobile && expanded}
	<button
		type="button"
		class="rail-panel-scrim"
		aria-label="Close board controls"
		tabindex="-1"
		onpointerdown={(event) => {
			event.stopPropagation();
			expanded = false;
			closeMenu(false);
		}}
		in:fade={{ duration: motion.current ? 0 : 180 }}
		out:fade={{ duration: motion.current ? 0 : 140 }}
	></button>
{/if}

{#if menu !== null && isMobile}
	<button
		type="button"
		class="rail-menu-scrim"
		aria-label="Close menu"
		tabindex="-1"
		onpointerdown={(event) => {
			event.stopPropagation();
			closeMenu(false);
		}}
		onclick={(event) => event.preventDefault()}
		in:fade={{ duration: motion.current ? 0 : 200 }}
		out:fade={{ duration: motion.current ? 0 : 160 }}
	></button>
{/if}

{#if menu !== null}
	<div class="rail-menu-anchor" class:is-sheet={isMobile} style={isMobile ? '' : menuStyle}>
		<div
			bind:this={menuEl}
			class="rail-menu"
			role="dialog"
			aria-label={menuTitle}
			aria-modal={isMobile ? 'true' : undefined}
			tabindex="-1"
			in:popIn={{ mobile: isMobile }}
			out:popOut={{ mobile: isMobile }}
		>
			<div class="menu-head">
				<span class="menu-title">{menuTitle}</span>
				<button
					type="button"
					class="menu-close"
					aria-label="Close menu"
					onclick={() => closeMenu()}
				>
					<Icon name="x" size={14} />
				</button>
			</div>

			{#if shownMenu === 'scope'}
				<div class="menu-list" role="group" aria-label="Scope options">
					<button
						type="button"
						class="menu-option"
						aria-pressed={scope === 'open'}
						onclick={() => chooseScope('open')}
					>
						<span class="option-copy">
							<span class="option-label">Open only</span>
							<span class="option-hint">Hide closed issues</span>
						</span>
						{#if scope === 'open'}
							<span class="option-check"><Icon name="check" size={14} /></span>
						{/if}
					</button>
					<button
						type="button"
						class="menu-option"
						aria-pressed={scope === 'all'}
						onclick={() => chooseScope('all')}
					>
						<span class="option-copy">
							<span class="option-label">All issues</span>
							<span class="option-hint">Include closed issues</span>
						</span>
						{#if scope === 'all'}
							<span class="option-check"><Icon name="check" size={14} /></span>
						{/if}
					</button>
				</div>
			{:else if shownMenu === 'milestone'}
				<div class="menu-list" role="group" aria-label="Milestone filter">
					<button
						type="button"
						class="menu-option"
						aria-pressed={milestone === 'all'}
						onclick={() => chooseMilestone('all')}
					>
						<span class="option-copy">
							<span class="option-label">All milestones</span>
						</span>
						{#if milestone === 'all'}
							<span class="option-check"><Icon name="check" size={14} /></span>
						{/if}
					</button>
					{#each options.milestones as option (option.value)}
						<button
							type="button"
							class="menu-option"
							aria-pressed={milestone === option.value}
							onclick={() => chooseMilestone(option.value)}
						>
							<span class="option-copy">
								<span class="option-label">{option.label}</span>
							</span>
							{#if milestone === option.value}
								<span class="option-check"><Icon name="check" size={14} /></span>
							{/if}
						</button>
					{/each}
				</div>
			{:else if shownMenu === 'assignee'}
				<div class="menu-list" role="group" aria-label="Assignee filter">
					<button
						type="button"
						class="menu-option"
						aria-pressed={assignee === 'all'}
						onclick={() => chooseAssignee('all')}
					>
						<span class="option-copy">
							<span class="option-label">All assignees</span>
						</span>
						{#if assignee === 'all'}
							<span class="option-check"><Icon name="check" size={14} /></span>
						{/if}
					</button>
					{#each options.assignees as option (option.value)}
						<button
							type="button"
							class="menu-option"
							aria-pressed={assignee === option.value}
							onclick={() => chooseAssignee(option.value)}
						>
							<span class="option-copy">
								<span class="option-label">{option.label}</span>
							</span>
							{#if assignee === option.value}
								<span class="option-check"><Icon name="check" size={14} /></span>
							{/if}
						</button>
					{/each}
				</div>
			{:else if shownMenu === 'stats'}
				<!-- The stats panel owns its own scrolling; make it a focusable region so keyboard users can scroll the notes. -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div class="menu-body" role="region" tabindex="0" aria-label="Board data details">
					{#if loading}
						<p class="menu-status">
							<span class="status-pulse" aria-hidden="true"></span>
							{progress || 'Loading repository…'}
						</p>
					{/if}

					<dl class="stats-grid">
						<div class="stat">
							<dt>Issues</dt>
							<dd>{counts?.issues ?? '—'}</dd>
						</div>
						<div class="stat">
							<dt>Dependencies</dt>
							<dd>{counts?.edges ?? '—'}</dd>
						</div>
						<div class="stat">
							<dt>Chains</dt>
							<dd>{counts?.chains ?? '—'}</dd>
						</div>
						<div class="stat">
							<dt>Independent</dt>
							<dd>{counts?.independent ?? '—'}</dd>
						</div>
					</dl>

					{#if warnings.length > 0}
						<div class="notes">
							<p class="notes-title">
								<Icon name="alert" size={13} />
								Data notes ({warnings.length})
							</p>
							<ul class="notes-list">
								{#each warnings as warning, index (index)}
									<li>{warning}</li>
								{/each}
							</ul>
						</div>
					{:else}
						<p class="menu-note">No data notes for this view.</p>
					{/if}
				</div>
			{:else if shownMenu === 'account'}
				<div class="menu-body account-body">
					<AuthControls
						next={authNext}
						showPrivateChoice
						showUnavailable
						onsignout={handleSignedOut}
					/>
				</div>
			{/if}
		</div>
	</div>
{/if}

<svelte:window
	onpointerdown={handlePointerDown}
	onkeydown={handleKeydown}
	onfocusin={handleFocusIn}
	onresize={handleResize}
/>

<style>
	.rail {
		--rail-ease: cubic-bezier(0.32, 0.72, 0, 1);
		--rail-out: cubic-bezier(0.23, 1, 0.32, 1);
		position: fixed;
		top: max(12px, env(safe-area-inset-top, 0px));
		bottom: max(12px, env(safe-area-inset-bottom, 0px));
		left: max(12px, env(safe-area-inset-left, 0px));
		z-index: 50;
		display: flex;
		flex-direction: column;
		width: 60px;
		padding: 7px;
		border: 1px solid color-mix(in oklab, var(--color-warm) 82%, white);
		border-radius: 22px;
		background: color-mix(in oklab, var(--color-paper) 84%, transparent);
		box-shadow:
			0 24px 56px -34px rgb(29 29 29 / 0.36),
			0 8px 20px -14px rgb(29 29 29 / 0.14),
			inset 0 1px 0 rgb(255 255 255 / 0.72);
		-webkit-backdrop-filter: blur(20px) saturate(1.35);
		backdrop-filter: blur(20px) saturate(1.35);
		transition: width 260ms var(--rail-ease);
	}

	.rail.is-expanded {
		width: min(268px, calc(100vw - max(12px, env(safe-area-inset-left, 0px)) - 12px));
		background: color-mix(in oklab, var(--color-paper) 92%, transparent);
	}

	.rail-head,
	.rail-group,
	.rail-foot {
		display: flex;
		flex: none;
		flex-direction: column;
		gap: 2px;
	}

	.rail-sections {
		display: contents;
	}

	.rail-sections-inner {
		display: flex;
		flex: none;
		flex-direction: column;
	}

	.rail-foot {
		margin-top: auto;
		padding-top: 2px;
	}

	.rail-divider {
		flex: none;
		height: 1px;
		margin: 5px 4px;
		border-radius: 999px;
		background: color-mix(in oklab, var(--color-line) 78%, transparent);
	}

	/* The section marker is one fixed row: a rule when the rail is thin, the
	   section title in the same slot when it opens. No title row is reserved in
	   the collapsed rail and nothing moves when the label appears. */
	.rail-rule {
		position: relative;
		flex: none;
		height: 21px;
		margin: 0 4px;
	}

	.rail-rule::before {
		content: '';
		position: absolute;
		top: 10px;
		right: 0;
		left: 0;
		height: 1px;
		border-radius: 999px;
		background: color-mix(in oklab, var(--color-line) 78%, transparent);
		transition: opacity 100ms ease-out;
	}

	.rail.is-expanded .rail-rule::before {
		opacity: 0;
	}

	.rail-section {
		position: absolute;
		inset: 0 0 0 11px;
		display: flex;
		align-items: center;
		overflow: hidden;
		color: var(--color-industrial);
		font-family: var(--font-mono);
		font-size: 9.5px;
		font-weight: 600;
		line-height: 1;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		white-space: nowrap;
		text-overflow: ellipsis;
		opacity: 0;
		pointer-events: none;
		transform: translateX(-4px);
		transition:
			opacity 100ms ease-out,
			transform 160ms var(--rail-out);
	}

	.rail.is-expanded .rail-section {
		opacity: 1;
		transform: none;
		transition:
			opacity 160ms ease-out 60ms,
			transform 200ms var(--rail-out) 60ms;
	}

	.rail-item {
		position: relative;
		display: flex;
		flex: none;
		align-items: center;
		gap: 10px;
		box-sizing: border-box;
		width: 100%;
		height: 40px;
		margin: 0;
		padding: 0 10px;
		border: 0;
		border-radius: 11px;
		background: transparent;
		color: var(--color-muted);
		font-family: inherit;
		font-size: inherit;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
		touch-action: manipulation;
		transition:
			background-color 150ms ease,
			color 150ms ease,
			transform 120ms var(--rail-out);
	}

	.rail-item:active:not(:disabled) {
		transform: scale(0.98);
	}

	.rail-item:disabled {
		cursor: default;
		opacity: 0.42;
	}

	.rail-item.is-busy:disabled {
		opacity: 1;
	}

	.rail-item.is-busy .rail-icon {
		animation: rail-spin 900ms linear infinite;
	}

	.rail-item:focus-visible {
		outline: 2px solid var(--color-brand-strong);
		outline-offset: 2px;
	}

	.rail-item.is-open {
		background: color-mix(in oklab, var(--color-chip) 82%, transparent);
		color: var(--color-ink);
	}

	.rail-item.is-open .rail-icon {
		color: var(--color-brand-strong);
	}

	.rail-brand {
		height: 42px;
		gap: 10px;
	}

	.brand-mark {
		position: relative;
		display: block;
		flex: none;
		width: 24px;
		height: 24px;
	}

	.brand-mark img {
		display: block;
		width: 100%;
		height: 100%;
	}

	.loading-dot {
		position: absolute;
		top: -2px;
		right: -2px;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-brand-strong);
		box-shadow: 0 0 0 2px var(--color-paper);
		animation: rail-pulse 1.4s ease-in-out infinite;
	}

	.rail-icon {
		position: relative;
		display: grid;
		flex: none;
		place-items: center;
		width: 24px;
		height: 24px;
	}

	/* The bar sits on the right when the rail is thin and slides left when the
	   panel opens, mirroring the sidebar state. */
	.panel-icon-bar {
		transform: translateX(7px);
		transition: transform 260ms var(--rail-ease);
	}

	.rail.is-expanded .panel-icon-bar {
		transform: none;
	}

	.rail-copy {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		overflow: hidden;
		opacity: 0;
		pointer-events: none;
		transform: translateX(-4px);
		transition:
			opacity 110ms ease-out,
			transform 160ms var(--rail-out);
	}

	.rail.is-expanded .rail-copy {
		opacity: 1;
		transform: none;
		transition:
			opacity 170ms ease-out 110ms,
			transform 200ms var(--rail-out) 110ms;
	}

	.rail-label,
	.brand-title {
		overflow: hidden;
		color: var(--color-ink);
		font-size: 12px;
		font-weight: 500;
		line-height: 1.25;
		letter-spacing: -0.005em;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.brand-title {
		font-size: 13px;
		font-weight: 600;
		letter-spacing: -0.015em;
	}

	.rail-value,
	.brand-sub {
		overflow: hidden;
		color: var(--color-quiet);
		font-family: var(--font-mono);
		font-size: 9.5px;
		font-weight: 400;
		line-height: 1.35;
		letter-spacing: -0.01em;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.brand-sub {
		font-size: 8.5px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.rail-trailing {
		display: grid;
		flex: none;
		place-items: center;
		width: 14px;
		height: 14px;
		color: var(--color-quiet);
		opacity: 0;
		pointer-events: none;
		transition: opacity 110ms ease-out;
	}

	.rail.is-expanded .rail-trailing {
		opacity: 1;
		transition: opacity 150ms ease-out 110ms;
	}

	.rail-dot {
		position: absolute;
		top: -1px;
		right: -1px;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-brand-strong);
		box-shadow: 0 0 0 2px var(--color-paper);
		opacity: 0;
		transform: scale(0.5);
		transition:
			opacity 140ms ease-out,
			transform 160ms var(--rail-out);
	}

	.rail-dot.is-on {
		opacity: 1;
		transform: scale(1);
	}

	.rail-dot.is-warning {
		background: var(--color-launch);
	}

	.rail-switch {
		position: relative;
		flex: none;
		width: 26px;
		height: 15px;
		border-radius: 999px;
		background: color-mix(in oklab, var(--color-warm) 80%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-warm) 70%, var(--color-quiet));
		opacity: 0;
		pointer-events: none;
		transition:
			background-color 170ms ease,
			opacity 110ms ease-out;
	}

	.rail-switch > span {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 11px;
		height: 11px;
		border-radius: 50%;
		background: var(--color-paper);
		box-shadow: 0 1px 2px rgb(29 29 29 / 0.24);
		transition: transform 180ms var(--rail-out);
	}

	.rail.is-expanded .rail-switch {
		opacity: 1;
		transition:
			background-color 170ms ease,
			opacity 150ms ease-out 110ms;
	}

	.rail-switch.is-on {
		background: var(--color-brand-strong);
		box-shadow: inset 0 0 0 1px var(--color-brand-deep);
	}

	.rail-switch.is-on > span {
		transform: translateX(11px);
	}

	.rail-avatar {
		flex: none;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--color-warm);
		object-fit: cover;
		box-shadow: 0 0 0 1px color-mix(in oklab, var(--color-warm) 72%, var(--color-quiet));
	}

	.avatar-skeleton {
		display: block;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: color-mix(in oklab, var(--color-warm) 70%, transparent);
		animation: rail-pulse 1.4s ease-in-out infinite;
	}

	.rail-item[data-tip]::after {
		content: attr(data-tip);
		position: absolute;
		top: 50%;
		left: calc(100% + 10px);
		z-index: 3;
		max-width: min(280px, calc(100vw - 92px));
		overflow: hidden;
		padding: 6px 8px;
		border-radius: 8px;
		background: var(--color-ink);
		box-shadow: 0 6px 16px -10px rgb(29 29 29 / 0.45);
		color: var(--color-paper);
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 500;
		line-height: 1.25;
		white-space: nowrap;
		text-overflow: ellipsis;
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transform: translate(-4px, -50%);
		transition:
			opacity 120ms ease-out,
			transform 160ms var(--rail-out),
			visibility 0s linear 160ms;
	}

	.rail[data-expanded='false'] .rail-item:focus-visible[data-tip]::after {
		opacity: 1;
		visibility: visible;
		transform: translate(0, -50%);
		transition-delay: 0s;
	}

	.rail.has-menu .rail-item[data-tip]::after {
		opacity: 0;
		visibility: hidden;
	}

	.rail-menu-anchor {
		position: fixed;
		z-index: 55;
	}

	.rail-menu-scrim {
		box-sizing: border-box;
		position: fixed;
		inset: 0;
		z-index: 54;
		margin: 0;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: rgb(29 29 29 / 0.32);
		cursor: default;
		touch-action: none;
	}

	.rail-panel-scrim {
		box-sizing: border-box;
		position: fixed;
		inset: 0;
		z-index: 49;
		margin: 0;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: rgb(29 29 29 / 0.28);
		cursor: default;
		touch-action: none;
	}

	.rail-menu-anchor.is-sheet {
		inset: auto max(12px, env(safe-area-inset-right, 0px))
			max(12px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px));
		z-index: 56;
	}

	.rail-menu-anchor.is-sheet .rail-menu {
		width: 100%;
		max-height: min(78dvh, 620px);
	}

	.rail-menu {
		display: flex;
		flex-direction: column;
		width: min(292px, calc(100vw - 96px));
		max-height: min(72dvh, 540px);
		overflow: hidden;
		border: 1px solid color-mix(in oklab, var(--color-warm) 88%, white);
		border-radius: 18px;
		background: color-mix(in oklab, var(--color-paper) 94%, transparent);
		box-shadow:
			0 24px 56px -30px rgb(29 29 29 / 0.34),
			0 10px 24px -18px rgb(29 29 29 / 0.18),
			inset 0 1px 0 rgb(255 255 255 / 0.7);
		-webkit-backdrop-filter: blur(24px) saturate(1.3);
		backdrop-filter: blur(24px) saturate(1.3);
		transform-origin: left center;
		outline: none;
	}

	.menu-head {
		display: flex;
		flex: none;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 8px 8px 12px;
		border-bottom: 1px solid color-mix(in oklab, var(--color-line) 82%, transparent);
	}

	.menu-title {
		color: var(--color-quiet);
		font-family: var(--font-mono);
		font-size: 8.5px;
		font-weight: 500;
		line-height: 1;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.menu-close {
		display: grid;
		flex: none;
		place-items: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--color-quiet);
		cursor: pointer;
		touch-action: manipulation;
		transition:
			background-color 120ms ease,
			color 120ms ease,
			transform 100ms var(--rail-out);
	}

	.menu-close:active {
		transform: scale(0.94);
	}

	.menu-close:focus-visible {
		outline: 2px solid var(--color-brand-strong);
		outline-offset: 1px;
	}

	.menu-list {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 6px;
		scrollbar-width: thin;
		scrollbar-color: var(--color-warm) transparent;
	}

	.menu-option {
		display: flex;
		flex: none;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 34px;
		padding: 6px 9px;
		border: 0;
		border-radius: 9px;
		background: transparent;
		color: var(--color-ink);
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		touch-action: manipulation;
		transition:
			background-color 120ms ease,
			color 120ms ease,
			transform 100ms var(--rail-out);
	}

	.menu-option:active {
		transform: scale(0.985);
	}

	.menu-option:focus-visible {
		outline: 2px solid var(--color-brand-strong);
		outline-offset: -2px;
	}

	.menu-option[aria-pressed='true'] {
		background: color-mix(in oklab, var(--color-brand) 9%, transparent);
		color: var(--color-brand-deep);
	}

	.option-copy {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.option-label {
		overflow: hidden;
		font-size: 12px;
		font-weight: 500;
		line-height: 1.3;
		text-overflow: ellipsis;
	}

	.option-hint {
		overflow: hidden;
		color: var(--color-quiet);
		font-family: var(--font-mono);
		font-size: 9px;
		line-height: 1.35;
		text-overflow: ellipsis;
	}

	.option-check {
		display: grid;
		flex: none;
		place-items: center;
		width: 14px;
		height: 14px;
		margin-left: auto;
		color: var(--color-brand-strong);
	}

	.menu-body {
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 10px;
		scrollbar-width: thin;
		scrollbar-color: var(--color-warm) transparent;
	}

	.menu-body:focus-visible {
		outline: 2px solid var(--color-brand-strong);
		outline-offset: -2px;
	}

	.menu-status {
		display: flex;
		align-items: center;
		gap: 7px;
		margin: 0 0 9px;
		color: var(--color-quiet);
		font-family: var(--font-mono);
		font-size: 9.5px;
		line-height: 1.4;
	}

	.status-pulse {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-brand-strong);
		animation: rail-pulse 1.4s ease-in-out infinite;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
		margin: 0;
	}

	.stat {
		padding: 9px 10px;
		border: 1px solid color-mix(in oklab, var(--color-line) 82%, transparent);
		border-radius: 11px;
		background: color-mix(in oklab, var(--color-canvas) 55%, transparent);
	}

	.stat dt {
		color: var(--color-quiet);
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 500;
		line-height: 1;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.stat dd {
		margin: 4px 0 0;
		color: var(--color-ink);
		font-size: 17px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
		letter-spacing: -0.02em;
	}

	.notes {
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid color-mix(in oklab, var(--color-line) 82%, transparent);
	}

	.notes-title {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		color: var(--color-launch);
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 500;
		line-height: 1.3;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.notes-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 8px 0 0;
		padding: 0;
		color: var(--color-muted);
		font-size: 11px;
		line-height: 1.45;
		list-style: none;
	}

	.notes-list li {
		position: relative;
		padding-left: 11px;
	}

	.notes-list li::before {
		content: '';
		position: absolute;
		top: 0.55em;
		left: 0;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: color-mix(in oklab, var(--color-launch) 55%, var(--color-warm));
	}

	.menu-note {
		margin: 10px 2px 1px;
		color: var(--color-quiet);
		font-family: var(--font-mono);
		font-size: 9.5px;
		line-height: 1.4;
	}

	.account-body {
		padding: 12px;
	}

	@media (hover: hover) and (pointer: fine) {
		.rail-item:hover:not(:disabled) {
			background: color-mix(in oklab, var(--color-chip) 76%, transparent);
			color: var(--color-ink);
		}

		.rail-item:hover:not(:disabled) .rail-icon {
			color: var(--color-ink);
		}

		.rail[data-expanded='false'] .rail-item[data-tip]:hover::after {
			opacity: 1;
			visibility: visible;
			transform: translate(0, -50%);
			transition-delay: 320ms, 320ms, 0s;
		}

		/* Once a tooltip has opened, siblings should not wait for it. */
		.rail.tips-warm .rail-item[data-tip]:hover::after {
			transition-delay: 0s;
			transition-duration: 0s;
		}

		.menu-close:hover {
			background: var(--color-chip);
			color: var(--color-ink);
		}

		.menu-option:hover {
			background: color-mix(in oklab, var(--color-chip) 70%, transparent);
		}

		.menu-option[aria-pressed='true']:hover {
			background: color-mix(in oklab, var(--color-brand) 13%, transparent);
		}
	}

	@media (pointer: coarse) {
		.rail-item {
			height: 44px;
		}

		.rail-brand {
			height: 46px;
		}

		.rail-divider {
			margin-block: 4px;
		}

		.menu-option {
			min-height: 44px;
			padding-block: 8px;
		}

		.menu-close {
			width: 34px;
			height: 34px;
		}

		.rail-switch {
			width: 32px;
			height: 19px;
		}

		.rail-switch > span {
			width: 15px;
			height: 15px;
		}

		.rail-switch.is-on > span {
			transform: translateX(13px);
		}

		.account-body :global(button) {
			min-height: 44px;
			padding-inline: 14px;
		}

		.account-body :global(input[type='checkbox']) {
			width: 20px;
			height: 20px;
		}
	}

	@media (max-height: 680px) and (pointer: fine) {
		.rail-item {
			height: 36px;
		}

		.rail-brand {
			height: 40px;
		}
	}

	@media (max-height: 680px) {
		.rail-divider {
			margin-block: 3px;
		}
	}

	@media (max-height: 560px) {
		.rail {
			overflow-x: clip;
			overflow-y: auto;
			scrollbar-width: none;
		}

		.rail::-webkit-scrollbar {
			display: none;
		}
	}

	/* Phones and short windows: the rail becomes a floating top bar. The
	   filter/action sections drop down from it as a separate panel. */
	@media (max-width: 767px), (max-height: 540px) {
		.rail {
			top: max(12px, env(safe-area-inset-top, 0px));
			right: max(12px, env(safe-area-inset-right, 0px));
			bottom: auto;
			left: max(12px, env(safe-area-inset-left, 0px));
			width: auto;
			min-height: 60px;
			flex-direction: row;
			flex-wrap: nowrap;
			align-items: center;
			gap: 2px;
			overflow: visible;
		}

		.rail.is-expanded {
			width: auto;
		}

		.rail-head,
		.rail-foot {
			display: contents;
		}

		.rail-head > .rail-item,
		.rail-foot > .rail-item {
			flex: none;
			width: auto;
			height: 44px;
			padding-inline: 10px;
		}

		.rail.is-expanded .rail-head > .rail-item,
		.rail.is-expanded .rail-foot > .rail-item {
			padding-inline: 10px;
		}

		.rail-head > .rail-brand {
			height: 44px;
		}

		.rail-brand .brand-mark {
			width: 28px;
			height: 28px;
		}

		.rail-head > a[target='_blank'] {
			flex: 1;
			min-width: 0;
		}

		.rail-divider-foot {
			display: none;
		}

		.rail-foot .rail-copy,
		.rail-foot .rail-trailing {
			display: none;
		}

		.rail-brand .rail-copy {
			display: flex;
			opacity: 1;
			transform: none;
		}

		.rail-brand .brand-sub {
			display: none;
		}

		.rail-head a[target='_blank'] .rail-copy {
			display: flex;
			opacity: 1;
			transform: none;
		}

		.rail-head a[target='_blank'] .rail-label,
		.rail-head a[target='_blank'] .rail-trailing {
			display: none;
		}

		.rail-head a[target='_blank'] .rail-value {
			font-size: 10px;
		}

		.rail-sections {
			position: absolute;
			top: calc(100% + 8px);
			right: -1px;
			left: -1px;
			display: flex;
			flex-direction: column;
			gap: 2px;
			max-height: min(64dvh, 460px);
			overflow-y: auto;
			overscroll-behavior: contain;
			padding: 8px;
			border: 1px solid color-mix(in oklab, var(--color-warm) 88%, white);
			border-radius: 20px;
			background: var(--color-paper);
			box-shadow:
				0 24px 56px -34px rgb(29 29 29 / 0.36),
				0 8px 20px -14px rgb(29 29 29 / 0.14),
				inset 0 1px 0 rgb(255 255 255 / 0.72);
			scrollbar-width: thin;
			scrollbar-color: var(--color-warm) transparent;
			opacity: 0;
			visibility: hidden;
			pointer-events: none;
			transform: translateY(-6px) scale(0.98);
			transform-origin: top center;
			transition:
				opacity 120ms ease-out,
				transform 160ms var(--rail-out),
				visibility 0s linear 160ms;
		}

		.rail.is-expanded .rail-sections {
			opacity: 1;
			visibility: visible;
			pointer-events: auto;
			transform: none;
			transition:
				opacity 180ms ease-out,
				transform 220ms var(--rail-out),
				visibility 0s;
		}

		.rail-item[data-tip]::after {
			display: none;
		}
	}

	@media (max-width: 359px) {
		.rail-brand .rail-copy {
			display: none;
		}
	}

	@media (prefers-reduced-transparency: reduce) {
		.rail,
		.rail-menu {
			background: var(--color-paper);
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
		}
	}

	@media (prefers-contrast: more) {
		.rail,
		.rail-menu,
		.rail-sections {
			border-color: var(--color-muted);
		}

		.rail-dot,
		.loading-dot {
			box-shadow: 0 0 0 2px var(--color-paper);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.rail {
			transition: none;
		}

		.rail-item,
		.rail-copy,
		.rail-trailing,
		.rail-switch,
		.rail-switch > span,
		.rail-dot,
		.rail-rule::before,
		.rail-section,
		.rail-sections,
		.panel-icon-bar,
		.menu-option,
		.menu-close,
		.rail-item::after {
			transition-duration: 0ms;
		}

		.rail-item:active,
		.menu-option:active,
		.menu-close:active {
			transform: none;
		}

		.loading-dot,
		.status-pulse,
		.avatar-skeleton,
		.rail-item.is-busy .rail-icon {
			animation: none;
		}
	}

	@keyframes rail-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes rail-pulse {
		0%,
		100% {
			opacity: 0.35;
			transform: scale(0.82);
		}
		50% {
			opacity: 1;
			transform: scale(1);
		}
	}
</style>
