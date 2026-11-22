import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * GitHub sign-in is optional: when these are missing, the board still works
 * anonymously and the UI reports that sign-in is not configured.
 */
function optional(value: string | undefined): string | undefined {
	return value?.trim() || undefined;
}

function sessionSecret(value: string | undefined): string | undefined {
	const secret = value?.trim();
	if (!secret) return undefined;
	if (secret.length < 16) {
		throw new Error('SESSION_SECRET must be at least 16 characters long');
	}
	return secret;
}

export const variables = defineEnvVars({
	GITHUB_CLIENT_ID: {
		description: 'Client ID of the GitHub OAuth App used for sign-in',
		schema: optional
	},
	GITHUB_CLIENT_SECRET: {
		description: 'Client secret of the GitHub OAuth App used for sign-in',
		schema: optional
	},
	SESSION_SECRET: {
		description: 'Random secret (16+ characters) used to encrypt the GitHub session cookie',
		schema: sessionSecret
	}
});
