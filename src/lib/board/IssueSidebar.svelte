<script lang="ts">
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import {
		GithubError,
		loadEditOptions,
		searchAssignableUsers,
		updateIssue,
		type AssignableUser,
		type EditOptions,
		type IssueChanges,
		type IssueUpdate
	} from '#lib/github';
	import type { IssueRecord, LabelInfo, MilestoneInfo } from '#lib/github';
	import { session } from '#lib/auth/session.svelte.ts';
	import Icon from '#lib/ui/Icon.svelte';

	interface Props {
		issue: IssueRecord;
		owner: string;
		repo: string;
		canEdit: boolean;
		open: boolean;
		onupdated: (update: IssueUpdate) => void;
	}

	let { issue, owner, repo, canEdit, open, onupdated }: Props = $props();

	type Field = 'assignees' | 'labels' | 'milestone';

	const MAX_ASSIGNEES = 10;
	const dueFormatter = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});

	let active = $state<Field | null>(null);
	let saving = $state<Field | null>(null);
	let fieldError = $state<string | null>(null);

	let options = $state<EditOptions | null>(null);
	let loadingOptions = $state(false);
	let optionsError = $state<string | null>(null);
	let optionsRequest = 0;

	let assignable = $state<AssignableUser[]>([]);
	let assigneeQuery = $state('');
	let searching = $state(false);
	let searchError = $state<string | null>(null);
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let searchRequest = 0;

	let labelFilter = $state('');

	let popoverEl = $state<HTMLElement | null>(null);
	let pickerStyle = $state('');
	let pickerAbove = $state(false);
	let pickerOpen = false;
	let triggerEl: HTMLElement | null = null;

	let pickerTitle = $derived(
		active === 'assignees' ? 'Assign people' : active === 'labels' ? 'Labels' : 'Set milestone'
	);

	onMount(() => {
		window.addEventListener('pointerdown', handleOutsidePointer, true);
		window.addEventListener('keydown', handleEscape, true);
		window.addEventListener('scroll', handleReflow, true);
		window.addEventListener('resize', handleReflow);
		window.visualViewport?.addEventListener('resize', handleReflow);
		window.visualViewport?.addEventListener('scroll', handleReflow);
		return () => {
			window.removeEventListener('pointerdown', handleOutsidePointer, true);
			window.removeEventListener('keydown', handleEscape, true);
			window.removeEventListener('scroll', handleReflow, true);
			window.removeEventListener('resize', handleReflow);
			window.visualViewport?.removeEventListener('resize', handleReflow);
			window.visualViewport?.removeEventListener('scroll', handleReflow);
		};
	});

	// The drawer stays mounted while it slides out; make sure a picker can't
	// survive it in the top layer.
	$effect(() => {
		if (open) return;
		untrack(() => closePicker());
	});

	// Assignees, labels and milestones are repository-level, not issue-level.
	// Warm them as soon as the drawer opens so the first gear click is instant.
	$effect(() => {
		if (!open || !canEdit) return;
		untrack(() => {
			if (!options && !loadingOptions) void loadOptions();
		});
	});

	$effect(() => {
		const el = popoverEl;
		if (!el) return;
		const observer = new ResizeObserver(() => placePicker());
		observer.observe(el);
		return () => observer.disconnect();
	});

	onDestroy(() => {
		if (searchTimer !== null) clearTimeout(searchTimer);
		if (popoverEl && pickerOpen) {
			try {
				popoverEl.hidePopover();
			} catch {
				// Already detached.
			}
		}
	});

	function handleOutsidePointer(event: PointerEvent): void {
		if (active === null) return;
		const target = event.target;
		if (!(target instanceof Node)) return;
		if (popoverEl?.contains(target)) return;
		if (target instanceof Element && target.closest('[data-picker-trigger]')) return;
		closePicker();
	}

	function handleEscape(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || active === null) return;
		event.preventDefault();
		event.stopPropagation();
		closePicker(true);
	}

	function handleReflow(event?: Event): void {
		if (event?.target instanceof Node && popoverEl?.contains(event.target)) return;
		if (active !== null && pickerOpen) placePicker();
	}

	function placePicker(): void {
		const trigger = triggerEl;
		const el = popoverEl;
		if (!trigger || !el || !pickerOpen) return;
		const pad = 16;
		const gap = 6;
		const rect = trigger.getBoundingClientRect();
		const viewport = window.visualViewport;
		const viewWidth = viewport?.width ?? window.innerWidth;
		const viewHeight = viewport?.height ?? window.innerHeight;
		el.style.maxHeight = `${Math.max(140, Math.min(460, viewHeight - pad * 2))}px`;
		const width = el.offsetWidth;
		const height = el.offsetHeight;
		const left = Math.min(
			Math.max(pad, rect.right - width),
			Math.max(pad, viewWidth - width - pad)
		);
		let top = rect.bottom + gap;
		let above = false;
		if (top + height > viewHeight - pad) {
			const abovePosition = rect.top - gap - height;
			above = abovePosition >= pad;
			top = above ? abovePosition : Math.max(pad, viewHeight - height - pad);
		}
		pickerAbove = above;
		pickerStyle = `left:max(${Math.round(left)}px, env(safe-area-inset-left, 0px));top:max(${Math.round(top)}px, env(safe-area-inset-top, 0px));`;
	}

	async function openPicker(field: Field, trigger: HTMLElement): Promise<void> {
		triggerEl = trigger;
		active = field;
		fieldError = null;
		searchError = null;
		if (!options && !loadingOptions) void loadOptions();
		if (field === 'assignees') {
			assigneeQuery = '';
			assignable = options?.assignees ?? [];
		}
		if (field === 'labels') labelFilter = '';
		await tick();
		const el = popoverEl;
		if (!el || active !== field || !el.isConnected) return;
		if (!pickerOpen) {
			try {
				el.showPopover();
			} catch {
				return;
			}
			pickerOpen = true;
		}
		placePicker();
		const finePointer = window.matchMedia('(pointer: fine)').matches;
		const target =
			el.querySelector<HTMLElement>('input[type="search"]') ??
			el.querySelector<HTMLElement>('.picker-option') ??
			el.querySelector<HTMLElement>('.picker-close');
		if (finePointer && target) target.focus({ preventScroll: true });
		else el.focus({ preventScroll: true });
	}

	function closePicker(restoreFocus = false): void {
		const trigger = triggerEl;
		active = null;
		fieldError = null;
		if (popoverEl && pickerOpen) {
			try {
				popoverEl.hidePopover();
			} catch {
				// The element may already be gone.
			}
		}
		pickerOpen = false;
		triggerEl = null;
		if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
	}

	function toggle(field: Field, trigger: HTMLElement): void {
		if (!canEdit || saving !== null) return;
		if (active === field) {
			closePicker(true);
			return;
		}
		void openPicker(field, trigger);
	}

	async function loadOptions(): Promise<void> {
		const id = ++optionsRequest;
		loadingOptions = true;
		optionsError = null;
		try {
			const loaded = await loadEditOptions(owner, repo);
			if (id !== optionsRequest) return;
			options = loaded;
			assignable = loaded.assignees;
		} catch (err) {
			if (id !== optionsRequest) return;
			optionsError = messageFor(err, 'Could not load assignees, labels and milestones.');
		} finally {
			if (id === optionsRequest) loadingOptions = false;
		}
	}

	function queueAssigneeSearch(): void {
		if (searchTimer !== null) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			searchTimer = null;
			void runAssigneeSearch();
		}, 250);
	}

	async function runAssigneeSearch(): Promise<void> {
		const query = assigneeQuery.trim();
		if (!query) {
			assignable = options?.assignees ?? [];
			searchError = null;
			return;
		}
		const id = ++searchRequest;
		searching = true;
		searchError = null;
		try {
			const results = await searchAssignableUsers(owner, repo, query);
			if (id !== searchRequest) return;
			assignable = results;
		} catch (err) {
			if (id !== searchRequest) return;
			searchError = messageFor(err, 'Could not search GitHub users.');
			if (err instanceof GithubError && err.kind === 'auth') void session.refresh();
		} finally {
			if (id === searchRequest) searching = false;
		}
	}

	function messageFor(err: unknown, fallback: string): string {
		return err instanceof GithubError ? err.message : fallback;
	}

	async function save(field: Field, changes: IssueChanges): Promise<boolean> {
		if (saving !== null || !canEdit) return false;
		saving = field;
		fieldError = null;
		try {
			const update = await updateIssue(issue.id, changes);
			onupdated(update);
			return true;
		} catch (err) {
			fieldError = messageFor(err, 'Could not update the issue on GitHub.');
			if (err instanceof GithubError && err.kind === 'auth') void session.refresh();
			return false;
		} finally {
			saving = null;
		}
	}

	let selectedAssigneeIds = $derived(issue.assignees.map((user) => user.id).filter(Boolean));
	let selectedLabelIds = $derived(issue.labels.map((label) => label.id).filter(Boolean));

	let assigneeChoices = $derived.by(() => {
		const byId: Record<string, AssignableUser> = {};
		for (const user of assignable) byId[user.id] = user;
		// Keep current assignees visible while a search narrows the list.
		for (const user of issue.assignees) {
			if (user.id && !byId[user.id]) {
				byId[user.id] = {
					id: user.id,
					login: user.login,
					name: null,
					avatarUrl: user.avatarUrl
				};
			}
		}
		return Object.values(byId).sort((a, b) => a.login.localeCompare(b.login));
	});

	let labelChoices = $derived.by(() => {
		const byId: Record<string, LabelInfo> = {};
		for (const label of options?.labels ?? []) byId[label.id] = label;
		for (const label of issue.labels) {
			if (label.id) byId[label.id] = label;
		}
		const query = labelFilter.trim().toLowerCase();
		return Object.values(byId)
			.filter((label) => label.id !== '' && (!query || label.name.toLowerCase().includes(query)))
			.sort((a, b) => a.name.localeCompare(b.name));
	});

	let milestoneChoices = $derived.by(() => {
		const list = options?.milestones ?? [];
		const current = issue.milestone;
		if (current && !list.some((milestone) => milestone.id === current.id)) {
			return [current, ...list];
		}
		return list;
	});

	function toggleAssignee(user: AssignableUser): void {
		if (saving !== null) return;
		const ids = issue.assignees.map((assignee) => assignee.id).filter(Boolean);
		if (ids.includes(user.id)) {
			void save('assignees', { assigneeIds: ids.filter((id) => id !== user.id) });
			return;
		}
		if (ids.length >= MAX_ASSIGNEES) return;
		void save('assignees', { assigneeIds: [...ids, user.id] });
	}

	function toggleLabel(label: LabelInfo): void {
		if (saving !== null) return;
		const ids = issue.labels.map((value) => value.id).filter(Boolean);
		const next = ids.includes(label.id) ? ids.filter((id) => id !== label.id) : [...ids, label.id];
		void save('labels', { labelIds: next });
	}

	async function chooseMilestone(milestoneId: string | null): Promise<void> {
		if (saving !== null) return;
		if ((issue.milestone?.id ?? null) === milestoneId) {
			closePicker(true);
			return;
		}
		const applied = await save('milestone', { milestoneId });
		if (applied) closePicker(true);
	}

	function labelStyle(color: string): string {
		const safe = /^[0-9a-f]{6}$/i.test(color) ? color : 'd4d4d4';
		return `--label-color: #${safe}`;
	}

	function avatarInitial(user: AssignableUser): string {
		return user.login.slice(0, 1).toUpperCase();
	}

	function hideBrokenAvatar(event: Event): void {
		const image = event.currentTarget as HTMLImageElement | null;
		if (image) image.hidden = true;
	}

	function milestoneProgressLabel(milestone: MilestoneInfo): string {
		return Number.isFinite(milestone.progressPercentage)
			? `${Math.round(milestone.progressPercentage)}% complete`
			: 'progress unavailable';
	}

	function dueLabel(milestone: MilestoneInfo): string {
		const progress = milestoneProgressLabel(milestone);
		if (!milestone.dueOn) return `No due date · ${progress}`;
		const date = new Date(milestone.dueOn);
		if (Number.isNaN(date.getTime())) return progress;
		return `Due by ${dueFormatter.format(date)} · ${progress}`;
	}
</script>

<dl class="flex flex-col gap-2 text-[11.5px]">
	<div class="flex items-start gap-2">
		<dt class="w-20 shrink-0 font-mono text-[9px] leading-4 tracking-[0.08em] text-quiet uppercase">
			assignees
		</dt>
		<dd class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-muted">
			{#if issue.assignees.length === 0}
				<span class="font-medium text-muted">Unassigned</span>
			{:else}
				{#each issue.assignees as assignee (assignee.login)}
					<span class="flex items-center gap-1.5">
						<span
							class="relative h-[18px] w-[18px] shrink-0 overflow-hidden rounded-full bg-warm ring-2 ring-paper"
						>
							<span
								class="absolute inset-0 flex items-center justify-center font-mono text-[8px] font-medium text-muted"
								aria-hidden="true"
							>
								{assignee.login.slice(0, 1).toUpperCase()}
							</span>
							<img
								src={assignee.avatarUrl}
								alt=""
								loading="lazy"
								class="relative h-full w-full object-cover"
								onerror={hideBrokenAvatar}
							/>
						</span>
						<span>@{assignee.login}</span>
					</span>
				{/each}
			{/if}
		</dd>
		{#if canEdit}
			<button
				type="button"
				class="field-edit"
				data-picker-trigger
				aria-label="Edit assignees"
				aria-haspopup="dialog"
				aria-controls="issue-picker"
				aria-expanded={active === 'assignees'}
				onclick={(event) => toggle('assignees', event.currentTarget)}
			>
				<Icon name="settings" size={13} />
			</button>
		{/if}
	</div>

	<div class="flex items-start gap-2">
		<dt class="w-20 shrink-0 font-mono text-[9px] leading-4 tracking-[0.08em] text-quiet uppercase">
			labels
		</dt>
		<dd class="flex min-w-0 flex-1 flex-wrap gap-1">
			{#if issue.labels.length === 0}
				<span class="text-quiet">—</span>
			{:else}
				{#each issue.labels as label (label.name)}
					<span
						class="inline-flex h-[19px] items-center gap-1 rounded-[5px] border border-chip-line bg-chip px-1.5 text-[10.5px] leading-none font-medium text-muted"
						style={labelStyle(label.color)}
						title={label.name}
					>
						<span class="label-dot h-[5px] w-[5px] shrink-0 rounded-full" aria-hidden="true"></span>
						{label.name}
					</span>
				{/each}
			{/if}
		</dd>
		{#if canEdit}
			<button
				type="button"
				class="field-edit"
				data-picker-trigger
				aria-label="Edit labels"
				aria-haspopup="dialog"
				aria-controls="issue-picker"
				aria-expanded={active === 'labels'}
				onclick={(event) => toggle('labels', event.currentTarget)}
			>
				<Icon name="settings" size={13} />
			</button>
		{/if}
	</div>

	<div class="flex items-start gap-2">
		<dt class="w-20 shrink-0 font-mono text-[9px] leading-4 tracking-[0.08em] text-quiet uppercase">
			milestone
		</dt>
		<dd class="min-w-0 flex-1 text-muted">
			{#if issue.milestone}
				<span class="flex flex-col gap-0.5">
					<span class="inline-flex items-center gap-1.5">
						<Icon name="flag" size={11} class="shrink-0 text-brand" />
						{issue.milestone.title}
					</span>
					<span class="font-mono text-[9px] leading-4 text-quiet">
						{dueLabel(issue.milestone)}
					</span>
				</span>
			{:else}
				<span class="text-quiet">No milestone</span>
			{/if}
		</dd>
		{#if canEdit}
			<button
				type="button"
				class="field-edit"
				data-picker-trigger
				aria-label="Edit milestone"
				aria-haspopup="dialog"
				aria-controls="issue-picker"
				aria-expanded={active === 'milestone'}
				onclick={(event) => toggle('milestone', event.currentTarget)}
			>
				<Icon name="settings" size={13} />
			</button>
		{/if}
	</div>

	<div class="flex gap-2">
		<dt class="w-20 shrink-0 font-mono text-[9px] leading-4 tracking-[0.08em] text-quiet uppercase">
			activity
		</dt>
		<dd class="min-w-0 font-mono text-[10px] leading-4 text-quiet">
			reactions <span class="text-muted">{issue.reactions ? issue.reactions.total : '?'}</span>
			· comments <span class="text-muted">{issue.comments}</span>
		</dd>
	</div>
</dl>

{#if active}
	<div
		id="issue-picker"
		bind:this={popoverEl}
		class={['picker', { 'picker-above': pickerAbove }]}
		popover="manual"
		role="dialog"
		aria-label={pickerTitle}
		tabindex="-1"
		style={pickerStyle}
	>
		<div class="picker-head">
			<span class="picker-title">{pickerTitle}</span>
			{#if active === 'assignees'}
				<span class="picker-count">{selectedAssigneeIds.length}/{MAX_ASSIGNEES}</span>
			{:else if active === 'labels'}
				<span class="picker-count">{selectedLabelIds.length}</span>
			{/if}
			{#if saving === active}<span class="picker-saving">Saving…</span>{/if}
			<button
				type="button"
				class="picker-close"
				aria-label="Close picker"
				onclick={() => closePicker(true)}
			>
				<Icon name="x" size={13} />
			</button>
		</div>

		{#if fieldError}
			<p class="picker-error" role="alert">{fieldError}</p>
		{/if}

		{#if loadingOptions}
			<p class="picker-note">Loading…</p>
		{:else if optionsError}
			<div class="picker-error-row">
				<span>{optionsError}</span>
				<button type="button" class="picker-retry" onclick={() => void loadOptions()}>
					Retry
				</button>
			</div>
		{:else if active === 'assignees'}
			<input
				type="search"
				class="picker-search"
				placeholder="Search people by name or login…"
				aria-label="Search assignable people"
				autocapitalize="none"
				autocomplete="off"
				autocorrect="off"
				spellcheck="false"
				enterkeyhint="search"
				bind:value={assigneeQuery}
				oninput={queueAssigneeSearch}
			/>
			{#if searchError}
				<p class="picker-error" role="alert">{searchError}</p>
			{:else if searching}
				<p class="picker-note">Searching GitHub…</p>
			{/if}
			<ul class="picker-list">
				{#each assigneeChoices as user (user.id)}
					{@const selected = selectedAssigneeIds.includes(user.id)}
					{@const full = !selected && selectedAssigneeIds.length >= MAX_ASSIGNEES}
					<li>
						<button
							type="button"
							class="picker-option"
							aria-pressed={selected}
							disabled={saving !== null || full}
							onclick={() => toggleAssignee(user)}
						>
							<span
								class="relative grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded-full bg-warm font-mono text-[8px] font-medium text-muted"
								aria-hidden="true"
							>
								{avatarInitial(user)}
								{#if user.avatarUrl}
									<img
										src={user.avatarUrl}
										alt=""
										loading="lazy"
										class="absolute inset-0 h-full w-full object-cover"
										onerror={hideBrokenAvatar}
									/>
								{/if}
							</span>
							<span class="flex min-w-0 flex-1 flex-col">
								<span class="truncate font-medium">{user.name ?? user.login}</span>
								<span class="truncate font-mono text-[9.5px] text-quiet">@{user.login}</span>
							</span>
							{#if selected}
								<Icon name="check" size={13} class="shrink-0 text-brand-strong" />
							{/if}
						</button>
					</li>
				{:else}
					<li class="picker-empty">
						{#if assigneeQuery.trim()}
							No assignable people match “{assigneeQuery.trim()}”.
						{:else}
							No assignable people found.
						{/if}
					</li>
				{/each}
			</ul>
			<p class="picker-note">Only people with access to {owner}/{repo} can be assigned.</p>
		{:else if active === 'labels'}
			<input
				type="search"
				class="picker-search"
				placeholder="Filter labels…"
				aria-label="Filter labels"
				autocapitalize="none"
				autocomplete="off"
				autocorrect="off"
				spellcheck="false"
				enterkeyhint="search"
				bind:value={labelFilter}
			/>
			<ul class="picker-list">
				{#each labelChoices as label (label.id)}
					{@const selected = selectedLabelIds.includes(label.id)}
					<li>
						<button
							type="button"
							class="picker-option"
							aria-pressed={selected}
							disabled={saving !== null}
							style={labelStyle(label.color)}
							onclick={() => toggleLabel(label)}
						>
							<span class="label-dot h-[6px] w-[6px] shrink-0 rounded-full" aria-hidden="true"
							></span>
							<span class="min-w-0 flex-1 truncate">{label.name}</span>
							{#if selected}
								<Icon name="check" size={13} class="shrink-0 text-brand-strong" />
							{/if}
						</button>
					</li>
				{:else}
					<li class="picker-empty">
						{#if labelFilter.trim()}
							No labels match “{labelFilter.trim()}”.
						{:else}
							This repository has no labels.
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<ul class="picker-list">
				<li>
					<button
						type="button"
						class="picker-option"
						aria-pressed={!issue.milestone}
						disabled={saving !== null}
						onclick={() => void chooseMilestone(null)}
					>
						<span class="min-w-0 flex-1">No milestone</span>
						{#if !issue.milestone}
							<Icon name="check" size={13} class="shrink-0 text-brand-strong" />
						{/if}
					</button>
				</li>
				{#each milestoneChoices as milestone (milestone.id)}
					{@const selected = issue.milestone?.id === milestone.id}
					<li>
						<button
							type="button"
							class="picker-option"
							aria-pressed={selected}
							disabled={saving !== null}
							onclick={() => void chooseMilestone(milestone.id)}
						>
							<span class="flex min-w-0 flex-1 flex-col">
								<span class="flex items-center gap-1.5">
									<Icon
										name="flag"
										size={11}
										class="shrink-0 {milestone.state === 'open' ? 'text-brand' : 'text-quiet'}"
									/>
									<span class="truncate font-medium">{milestone.title}</span>
									{#if milestone.state === 'closed'}
										<span class="picker-tag">closed</span>
									{/if}
								</span>
								<span class="truncate font-mono text-[9px] text-quiet">
									{dueLabel(milestone)}
								</span>
							</span>
							{#if selected}
								<Icon name="check" size={13} class="shrink-0 text-brand-strong" />
							{/if}
						</button>
					</li>
				{:else}
					<li class="picker-empty">This repository has no open milestones.</li>
				{/each}
			</ul>
			<p class="picker-note">Only open milestones are listed.</p>
		{/if}
	</div>
{/if}

<style>
	.field-edit {
		display: grid;
		flex: none;
		place-items: center;
		width: 24px;
		height: 24px;
		margin: -3px -4px 0 0;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--color-quiet);
		cursor: pointer;
		touch-action: manipulation;
		transition:
			background-color 120ms ease,
			color 120ms ease,
			transform 100ms ease-out;
	}

	.field-edit:active {
		transform: scale(0.94);
	}

	.field-edit:focus-visible {
		outline: 2px solid var(--color-brand-strong);
		outline-offset: 1px;
	}

	/* Top-layer popover: it never participates in the drawer's layout. */
	.picker {
		--picker-shift: -4px;
		position: fixed;
		inset: auto;
		z-index: 100;
		box-sizing: border-box;
		width: min(320px, calc(100vw - 24px));
		max-height: min(460px, calc(100dvh - 24px));
		margin: 0;
		padding: 10px;
		overflow-y: auto;
		overscroll-behavior: contain;
		border: 1px solid color-mix(in oklab, var(--color-warm) 88%, white);
		border-radius: 12px;
		background: var(--color-paper);
		box-shadow:
			0 18px 44px -22px rgb(16 16 16 / 0.35),
			0 8px 18px -14px rgb(16 16 16 / 0.18),
			inset 0 1px 0 rgb(255 255 255 / 0.7);
		color: var(--color-ink);
		outline: none;
		transform-origin: top right;
		animation: picker-in 160ms cubic-bezier(0.23, 1, 0.32, 1);
	}

	.picker.picker-above {
		--picker-shift: 4px;
		transform-origin: bottom right;
	}

	@keyframes picker-in {
		from {
			opacity: 0;
			transform: translateY(var(--picker-shift)) scale(0.97);
		}
	}

	.picker::backdrop {
		background: transparent;
	}

	.picker-head {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 20px;
	}

	.picker-title {
		color: var(--color-quiet);
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 500;
		line-height: 1;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.picker-count {
		color: var(--color-quiet);
		font-family: var(--font-mono);
		font-size: 9px;
		font-variant-numeric: tabular-nums;
	}

	.picker-saving {
		margin-left: 4px;
		color: var(--color-brand-strong);
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.04em;
	}

	.picker-close {
		display: grid;
		flex: none;
		place-items: center;
		width: 22px;
		height: 22px;
		margin-left: auto;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--color-quiet);
		cursor: pointer;
		touch-action: manipulation;
		transition:
			background-color 120ms ease,
			color 120ms ease,
			transform 100ms ease-out;
	}

	.picker-close:active {
		transform: scale(0.94);
	}

	.picker-close:focus-visible {
		outline: 2px solid var(--color-brand-strong);
		outline-offset: 1px;
	}

	.picker-error {
		margin: 6px 0 0;
		color: #a9272a;
		font-size: 10.5px;
		line-height: 1.45;
	}

	.picker-error-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px;
		margin-top: 4px;
		color: #a9272a;
		font-size: 10.5px;
		line-height: 1.45;
	}

	.picker-retry {
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-brand-strong);
		font-family: inherit;
		font-size: 10.5px;
		font-weight: 600;
		text-decoration: underline;
		cursor: pointer;
		transition: opacity 120ms ease;
	}

	.picker-retry:active {
		opacity: 0.65;
	}

	.picker-search {
		box-sizing: border-box;
		width: 100%;
		margin-top: 6px;
		padding: 5px 8px;
		border: 1px solid var(--color-warm);
		border-radius: 7px;
		background: var(--color-paper);
		color: var(--color-ink);
		font-family: inherit;
		font-size: 11px;
		box-shadow: 0 1px 2px rgb(16 16 16 / 0.04);
	}

	.picker-search:focus {
		outline: 2px solid color-mix(in oklab, var(--color-brand) 25%, transparent);
		outline-offset: 0;
	}

	.picker-list {
		display: flex;
		flex-direction: column;
		gap: 1px;
		max-height: 210px;
		margin: 5px 0 0;
		padding: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		list-style: none;
		scrollbar-width: thin;
		scrollbar-color: var(--color-warm) transparent;
	}

	.picker-option {
		display: flex;
		align-items: center;
		gap: 8px;
		box-sizing: border-box;
		width: 100%;
		min-height: 32px;
		padding: 4px 6px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--color-ink);
		font-family: inherit;
		font-size: 11.5px;
		text-align: left;
		cursor: pointer;
		touch-action: manipulation;
		transition: background-color 120ms ease;
	}

	.picker-option:disabled {
		cursor: default;
		opacity: 0.45;
	}

	.picker-option[aria-pressed='true'] {
		background: color-mix(in oklab, var(--color-brand) 9%, transparent);
		color: var(--color-brand-deep);
	}

	.picker-option:active:not(:disabled) {
		background: color-mix(in oklab, var(--color-brand) 16%, transparent);
	}

	.picker-option:focus-visible {
		outline: 2px solid var(--color-brand-strong);
		outline-offset: -2px;
	}

	.picker-empty {
		padding: 6px;
		color: var(--color-quiet);
		font-size: 10.5px;
		line-height: 1.45;
	}

	.picker-note {
		margin: 6px 0 0;
		color: var(--color-quiet);
		font-family: var(--font-mono);
		font-size: 9px;
		line-height: 1.4;
	}

	.picker-tag {
		flex: none;
		border-radius: 4px;
		background: color-mix(in oklab, var(--color-warm) 60%, transparent);
		padding: 1px 4px;
		color: var(--color-quiet);
		font-family: var(--font-mono);
		font-size: 8px;
		line-height: 1.3;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.label-dot {
		background: color-mix(in srgb, var(--label-color) 72%, var(--color-ink));
		box-shadow: 0 0 0 1px rgb(16 16 16 / 0.06);
	}

	@media (hover: hover) and (pointer: fine) {
		.field-edit:hover {
			background: var(--color-chip);
			color: var(--color-ink);
		}

		.picker-close:hover {
			background: var(--color-chip);
			color: var(--color-ink);
		}

		.picker-option:hover:not(:disabled) {
			background: color-mix(in oklab, var(--color-chip) 70%, transparent);
		}

		.picker-option[aria-pressed='true']:hover:not(:disabled) {
			background: color-mix(in oklab, var(--color-brand) 13%, transparent);
		}
	}

	@media (pointer: coarse) {
		.field-edit {
			width: 44px;
			height: 44px;
			margin-top: -11px;
			margin-right: -7px;
		}

		.picker-search {
			min-height: 44px;
			font-size: 16px;
		}

		.picker-option {
			min-height: 44px;
		}

		.picker-close {
			width: 44px;
			height: 44px;
		}
	}

	@media (prefers-contrast: more) {
		.picker {
			border-color: var(--color-muted);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.field-edit {
			transition: none;
		}

		.field-edit:active {
			transform: none;
		}

		.picker {
			animation: none;
		}

		.picker-close,
		.picker-option,
		.picker-retry {
			transition: none;
		}

		.picker-close:active {
			transform: none;
		}
	}
</style>
