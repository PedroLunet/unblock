/**
 * Accessible chip colours from GitHub's label hex.
 *
 * The repository's colour is used as a hue only: a very light tint for the
 * background and a dark, same-hue ink. That keeps every label readable on every
 * pastel card fill without shipping a second contrast table.
 */
function parseHex(hex: string): [number, number, number] | null {
	const value = hex.replace(/^#/, '');
	if (!/^[0-9a-f]{6}$/i.test(value)) return null;
	return [
		Number.parseInt(value.slice(0, 2), 16),
		Number.parseInt(value.slice(2, 4), 16),
		Number.parseInt(value.slice(4, 6), 16)
	];
}

function hueOf(r: number, g: number, b: number): number {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	if (delta === 0) return 0;
	let hue: number;
	if (max === r) hue = ((g - b) / delta) % 6;
	else if (max === g) hue = (b - r) / delta + 2;
	else hue = (r - g) / delta + 4;
	hue *= 60;
	return hue < 0 ? hue + 360 : hue;
}

export function labelStyle(hex: string): string {
	const rgb = parseHex(hex);
	if (!rgb) return '';
	const [r, g, b] = rgb;
	const max = Math.max(r, g, b) / 255;
	const min = Math.min(r, g, b) / 255;
	const lightness = (max + min) / 2;
	const delta = max - min;
	const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
	const hue = Math.round(hueOf(r, g, b));
	const saturationPercent = Math.round(saturation * 100);
	// Grey labels keep a grey tint; saturated labels are softened so the chip
	// never shouts louder than the card's state.
	const tint = saturationPercent < 8 ? 0 : Math.min(45, saturationPercent);
	const ink = saturationPercent < 8 ? 0 : Math.min(55, saturationPercent);
	return [
		`background:hsl(${hue} ${tint}% 93%)`,
		`color:hsl(${hue} ${ink}% 24%)`,
		`border-color:hsl(${hue} ${Math.min(50, tint + 12)}% 76%)`
	].join(';');
}
