<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import { tick } from 'svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		open: boolean;
		onclose: () => void;
		/** Accessible name for the dialog. */
		label: string;
		/** Desktop width in px. Default 400. */
		width?: number;
		/** Header content. The shell owns the close button. */
		header?: Snippet;
		/** Body content. This is the only scrollable region. */
		children: Snippet;
		/** Bottom action row. Omit to render no footer. */
		actions?: Snippet;
	}

	let { open, onclose, label, width = 400, header, children, actions }: Props = $props();

	// Keep both queries in sync with the media queries in the style block below.
	const DESKTOP_QUERY = '(min-width: 1024px)';
	const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
	const DECELERATION = 0.998;
	const FOCUSABLE =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	const desktop = new MediaQuery(DESKTOP_QUERY, false);
	const motion = new MediaQuery(REDUCED_MOTION_QUERY, false);

	let isDesktop = $derived(desktop.current);
	let reducedMotion = $derived(motion.current);

	let panel = $state<HTMLElement | null>(null);
	let scrim = $state<HTMLButtonElement | null>(null);

	let dragPointerId: number | null = null;
	let dragHandleElement: HTMLElement | null = null;
	let dragStartY = 0;
	let dragBase = 0;
	let panelHeight = 0;
	let samples: { y: number; t: number }[] = [];
	let snapTimer: ReturnType<typeof setTimeout> | null = null;
	let wasOpen = false;
	let restoreFocus: HTMLElement | null = null;

	$effect(() => {
		if (isDesktop && dragPointerId !== null) cancelDrag();
	});

	$effect(() => {
		if (open) return;
		clearSnapTimer();
		if (dragPointerId !== null) cancelDrag();
		releasePanelDragStyles();
		releaseScrimDragStyles();
	});

	$effect.pre(() => {
		if (open || !wasOpen) return;
		wasOpen = false;
		const previous = restoreFocus;
		restoreFocus = null;
		if (previous?.isConnected) previous.focus({ preventScroll: true });
		const active = document.activeElement;
		if (active instanceof HTMLElement && (active === scrim || panel?.contains(active))) {
			active.blur();
		}
	});

	$effect(() => {
		if (!open || wasOpen) return;
		wasOpen = true;
		const active = document.activeElement;
		restoreFocus = active instanceof HTMLElement && active !== panel ? active : null;
		void tick().then(() => {
			if (open) panel?.focus({ preventScroll: true });
		});
	});

	$effect(() => {
		if (!open || isDesktop) return;

		const body = document.body;
		const previousOverflow = body.style.overflow;
		const previousPaddingRight = body.style.paddingRight;
		const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

		body.style.overflow = 'hidden';
		if (scrollbarWidth > 0) {
			const paddingRight = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
			body.style.paddingRight = `${paddingRight + scrollbarWidth}px`;
		}

		return () => {
			body.style.overflow = previousOverflow;
			body.style.paddingRight = previousPaddingRight;
		};
	});

	$effect(() => {
		return () => {
			clearSnapTimer();
			releasePanelDragStyles();
			releaseScrimDragStyles();
		};
	});

	function handleWindowKeydown(event: KeyboardEvent): void {
		if (!open) return;

		if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
			return;
		}

		if (event.key === 'Tab' && !isDesktop) trapFocus(event);
	}

	function trapFocus(event: KeyboardEvent): void {
		if (!panel) return;

		const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
			(element) => element.getClientRects().length > 0
		);

		if (focusables.length === 0) {
			event.preventDefault();
			panel.focus({ preventScroll: true });
			return;
		}

		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		const active = document.activeElement;

		if (event.shiftKey) {
			if (active === first || active === panel || !panel.contains(active)) {
				event.preventDefault();
				last.focus();
			}
			return;
		}

		if (active === last || active === panel || !panel.contains(active)) {
			event.preventDefault();
			first.focus();
		}
	}

	function attachDragHandle(node: HTMLElement): () => void {
		const handlePointerDown = (event: PointerEvent): void => beginDrag(event, node);
		const handlePointerMove = (event: PointerEvent): void => moveDrag(event);
		const handlePointerUp = (event: PointerEvent): void => endDrag(event, node);
		const handlePointerCancel = (event: PointerEvent): void => {
			if (event.pointerId === dragPointerId) cancelDrag();
		};
		const handleLostCapture = (event: PointerEvent): void => {
			if (event.pointerId === dragPointerId) cancelDrag();
		};
		const handleExtraPointer = (event: PointerEvent): void => {
			if (dragPointerId !== null && event.pointerId !== dragPointerId) cancelDrag();
		};

		node.addEventListener('pointerdown', handlePointerDown);
		node.addEventListener('pointermove', handlePointerMove);
		node.addEventListener('pointerup', handlePointerUp);
		node.addEventListener('pointercancel', handlePointerCancel);
		node.addEventListener('lostpointercapture', handleLostCapture);
		window.addEventListener('pointerdown', handleExtraPointer, true);

		return () => {
			node.removeEventListener('pointerdown', handlePointerDown);
			node.removeEventListener('pointermove', handlePointerMove);
			node.removeEventListener('pointerup', handlePointerUp);
			node.removeEventListener('pointercancel', handlePointerCancel);
			node.removeEventListener('lostpointercapture', handleLostCapture);
			window.removeEventListener('pointerdown', handleExtraPointer, true);
		};
	}

	function beginDrag(event: PointerEvent, node: HTMLElement): void {
		if (isDesktop || !open) return;

		if (dragPointerId !== null) {
			if (event.pointerId !== dragPointerId) cancelDrag();
			return;
		}

		if (!event.isPrimary || event.button !== 0) return;

		event.preventDefault();
		dragPointerId = event.pointerId;
		dragHandleElement = node;
		dragStartY = event.clientY;
		dragBase = panel ? currentTranslateY(panel) : 0;
		panelHeight = Math.max(1, panel?.getBoundingClientRect().height ?? 1);
		samples = [{ y: event.clientY, t: event.timeStamp }];
		clearSnapTimer();

		if (panel) {
			panel.style.transition = 'none';
			panel.style.transform = `translateY(${dragBase}px)`;
			panel.style.willChange = 'transform';
		}
		if (scrim) {
			scrim.style.transition = 'none';
			scrim.style.opacity = String(scrimOpacity(dragBase));
		}

		node.setPointerCapture(event.pointerId);
	}

	function moveDrag(event: PointerEvent): void {
		if (event.pointerId !== dragPointerId) return;

		if (!event.isPrimary) {
			cancelDrag();
			return;
		}

		const raw = dragBase + event.clientY - dragStartY;
		const offset = raw < 0 ? rubberBand(raw, panelHeight) : raw;

		if (panel) panel.style.transform = `translateY(${offset}px)`;
		if (scrim) scrim.style.opacity = String(scrimOpacity(offset));

		samples.push({ y: event.clientY, t: event.timeStamp });
		const cutoff = event.timeStamp - 100;
		while (samples.length > 1 && samples[0].t < cutoff) samples.shift();
	}

	function endDrag(event: PointerEvent, node: HTMLElement): void {
		if (event.pointerId !== dragPointerId) return;

		const pointerId = dragPointerId;
		dragPointerId = null;
		dragHandleElement = null;
		if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);

		samples.push({ y: event.clientY, t: event.timeStamp });
		const cutoff = event.timeStamp - 100;
		while (samples.length > 1 && samples[0].t < cutoff) samples.shift();

		const dy = dragBase + event.clientY - dragStartY;
		const velocity = releaseVelocity();
		const height = Math.max(1, panelHeight);
		const projected = dy + ((velocity / 1000) * DECELERATION) / (1 - DECELERATION);
		const dismiss = projected > height * 0.35 || dy > height * 0.5;

		if (dismiss) {
			if (reducedMotion) {
				releasePanelDragStyles();
				releaseScrimDragStyles();
			}
			onclose();
			if (!reducedMotion) {
				void tick().then(() => {
					releasePanelDragStyles();
					releaseScrimDragStyles();
				});
			}
			return;
		}

		snapBack();
	}

	function cancelDrag(): void {
		if (dragPointerId === null) return;

		const pointerId = dragPointerId;
		const node = dragHandleElement;
		dragPointerId = null;
		dragHandleElement = null;
		if (node?.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
		clearSnapTimer();
		samples = [];
		releasePanelDragStyles();
		releaseScrimDragStyles();
	}

	function snapBack(): void {
		clearSnapTimer();
		samples = [];
		releaseScrimDragStyles();

		if (reducedMotion) {
			releasePanelDragStyles();
			return;
		}

		if (!panel) return;
		panel.style.transition = 'transform 260ms var(--drawer-ease)';
		panel.style.transform = 'translateY(0px)';
		panel.style.willChange = 'transform';
		snapTimer = setTimeout(() => {
			snapTimer = null;
			releasePanelDragStyles();
		}, 280);
	}

	function releaseVelocity(): number {
		if (samples.length < 2) return 0;
		const first = samples[0];
		const last = samples[samples.length - 1];
		const elapsed = Math.max(1, last.t - first.t);
		return ((last.y - first.y) / elapsed) * 1000;
	}

	function currentTranslateY(element: HTMLElement): number {
		const transform = getComputedStyle(element).transform;
		if (!transform || transform === 'none') return 0;
		return new DOMMatrixReadOnly(transform).m42;
	}

	function rubberBand(overshoot: number, height: number): number {
		return (overshoot * height * 0.55) / (height + 0.55 * Math.abs(overshoot));
	}

	function scrimOpacity(offset: number): number {
		return Math.max(0, 1 - Math.max(0, offset) / Math.max(1, panelHeight));
	}

	function clearSnapTimer(): void {
		if (snapTimer === null) return;
		clearTimeout(snapTimer);
		snapTimer = null;
	}

	function releasePanelDragStyles(): void {
		if (!panel) return;
		panel.style.transition = '';
		panel.style.transform = '';
		panel.style.willChange = '';
	}

	function releaseScrimDragStyles(): void {
		if (!scrim) return;
		scrim.style.transition = '';
		scrim.style.opacity = '';
	}
</script>

<div class="drawer-root">
	<button
		bind:this={scrim}
		type="button"
		class={['drawer-scrim', { 'is-open': open }]}
		tabindex="-1"
		aria-label="Close drawer"
		aria-hidden={!open || isDesktop ? 'true' : undefined}
		onclick={onclose}
	></button>

	<div
		bind:this={panel}
		class={['drawer-panel', { 'is-open': open }]}
		role="dialog"
		aria-label={label}
		aria-modal={isDesktop ? undefined : 'true'}
		aria-hidden={!open ? 'true' : undefined}
		tabindex="-1"
		inert={!open}
		style={`--drawer-width: ${width}px`}
	>
		<div class="drawer-handle" aria-hidden="true" {@attach attachDragHandle}>
			<span class="drawer-handle-bar"></span>
		</div>

		<div class="drawer-header">
			<div class="min-w-0 flex-1">
				{@render header?.()}
			</div>
			<button type="button" class="drawer-close" aria-label="Close" onclick={onclose}>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M18 6 6 18" />
					<path d="m6 6 12 12" />
				</svg>
			</button>
		</div>

		<div class="drawer-body">
			{@render children()}
		</div>

		{#if actions}
			<div class="drawer-actions">
				{@render actions()}
			</div>
		{/if}
	</div>
</div>

<svelte:window onkeydown={handleWindowKeydown} />

<style>
	.drawer-root {
		--drawer-ease: cubic-bezier(0.32, 0.72, 0, 1);
		position: fixed;
		inset: 0;
		z-index: 60;
		overflow: clip;
		pointer-events: none;
	}

	.drawer-scrim {
		box-sizing: border-box;
		position: absolute;
		inset: 0;
		display: block;
		margin: 0;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: rgb(29 29 29 / 0.32);
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		cursor: default;
		transition:
			opacity 200ms ease-out,
			visibility 0s linear 200ms;
	}

	.drawer-scrim.is-open {
		opacity: 1;
		visibility: visible;
		pointer-events: auto;
		transition:
			opacity 200ms ease-out,
			visibility 0s;
	}

	.drawer-panel {
		box-sizing: border-box;
		position: absolute;
		/* Center with auto margins; individual `translate` is unreliable in
		   some mobile Chromium builds and pushes the sheet off the right edge. */
		right: max(10px, env(safe-area-inset-right, 0px));
		bottom: 10px;
		left: max(10px, env(safe-area-inset-left, 0px));
		z-index: 1;
		display: flex;
		flex-direction: column;
		width: auto;
		max-width: 560px;
		margin-inline: auto;
		max-height: min(85dvh, 760px);
		overflow: hidden;
		border: 1px solid var(--color-warm);
		border-radius: 20px;
		background: var(--color-paper);
		box-shadow:
			0 24px 64px -28px rgb(16 16 16 / 0.32),
			0 12px 24px -16px rgb(16 16 16 / 0.16),
			inset 0 1px 0 rgb(255 255 255 / 0.65);
		color: var(--color-ink);
		pointer-events: auto;
		outline: none;
		transform: translateY(calc(100% + 10px));
		visibility: hidden;
		transition:
			transform 220ms var(--drawer-ease),
			visibility 0s linear 220ms;
	}

	.drawer-panel.is-open {
		visibility: visible;
		transform: translateY(0);
		transition:
			transform 300ms var(--drawer-ease),
			visibility 0s;
	}

	.drawer-handle {
		display: flex;
		flex: none;
		height: 44px;
		align-items: center;
		justify-content: center;
		touch-action: none;
		cursor: grab;
	}

	.drawer-handle:active {
		cursor: grabbing;
	}

	.drawer-handle-bar {
		display: block;
		width: 40px;
		height: 4px;
		border-radius: 999px;
		background: #c9bcb0;
	}

	.drawer-header {
		position: relative;
		display: flex;
		flex: none;
		align-items: flex-start;
		gap: 16px;
		padding: 20px;
		border-bottom: 1px solid var(--color-line);
	}

	.drawer-close {
		position: absolute;
		top: 12px;
		right: 12px;
		display: grid;
		flex: none;
		place-items: center;
		width: 1px;
		height: 1px;
		margin: 0;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		border: 0;
		border-radius: 10px;
		background: transparent;
		color: var(--color-quiet);
		cursor: pointer;
		touch-action: manipulation;
		transition: transform 100ms ease-out;
	}

	.drawer-close::after {
		content: '';
		position: absolute;
		inset: -6px;
		border-radius: inherit;
	}

	.drawer-close:active {
		transform: scale(0.96);
	}

	.drawer-close:focus-visible {
		width: 44px;
		height: 44px;
		overflow: visible;
		clip-path: none;
		background: var(--color-chip);
		outline: 2px solid var(--color-brand-strong);
		outline-offset: 2px;
	}

	.drawer-body {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 20px;
		color: var(--color-ink);
	}

	.drawer-actions {
		display: flex;
		flex: none;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
		border-top: 1px solid var(--color-line);
	}

	@media (min-width: 1024px) {
		.drawer-scrim,
		.drawer-handle {
			display: none;
		}

		.drawer-panel {
			top: 16px;
			right: 16px;
			bottom: 16px;
			left: auto;
			width: min(var(--drawer-width, 400px), calc(100vw - 32px));
			max-width: none;
			margin-inline: 0;
			max-height: none;
			transform: translateX(calc(100% + 16px));
		}

		.drawer-panel.is-open {
			transform: translateX(0);
		}

		.drawer-close {
			position: relative;
			top: auto;
			right: auto;
			width: 32px;
			height: 32px;
			overflow: visible;
			clip-path: none;
			border: 0;
			background: transparent;
			box-shadow: none;
		}

		.drawer-close:focus-visible {
			width: 32px;
			height: 32px;
			border: 0;
			background: transparent;
			box-shadow: none;
			outline: 2px solid var(--color-brand-strong);
			outline-offset: 2px;
		}
	}

	@media (hover: hover) and (pointer: fine) {
		.drawer-handle:hover .drawer-handle-bar {
			background: #bcafa2;
		}

		.drawer-close:hover {
			background: var(--color-chip);
			color: var(--color-ink);
		}
	}

	@media (prefers-reduced-transparency: reduce) {
		.drawer-panel {
			background: var(--color-paper);
			backdrop-filter: none;
		}
	}

	@media (prefers-contrast: more) {
		.drawer-panel {
			border-color: var(--color-muted);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.drawer-panel {
			opacity: 0;
			transform: none;
			transition:
				opacity 180ms ease-out,
				visibility 0s linear 180ms;
		}

		.drawer-panel.is-open {
			opacity: 1;
			transform: none;
			visibility: visible;
			transition:
				opacity 180ms ease-out,
				visibility 0s;
		}

		.drawer-close:active {
			transform: none;
		}
	}
</style>
