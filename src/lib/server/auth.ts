import { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, SESSION_SECRET } from '$app/env/private';
import type { Cookies } from '@sveltejs/kit';

export const SESSION_COOKIE = 'unblock_session';
export const OAUTH_STATE_COOKIE = 'unblock_oauth';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_USER_URL = 'https://api.github.com/user';
const GITHUB_API_VERSION = '2022-11-28';

export interface SessionUser {
	login: string;
	name: string | null;
	avatarUrl: string;
	scopes: string[];
}

export interface Session extends SessionUser {
	token: string;
	issuedAt: number;
}

export interface OAuthState {
	state: string;
	next: string;
	privateRepos: boolean;
	/** Ask for `public_repo`/`repo` so the app can edit issues. */
	write: boolean;
	/** Ask for `read:project` so iteration fields can be read. */
	projects: boolean;
}

export interface OAuthToken {
	token: string;
	scopes: string[];
}

interface AuthConfig {
	clientId: string;
	clientSecret: string;
	sessionSecret: string;
}

function authConfig(): AuthConfig | null {
	if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !SESSION_SECRET) return null;
	return {
		clientId: GITHUB_CLIENT_ID,
		clientSecret: GITHUB_CLIENT_SECRET,
		sessionSecret: SESSION_SECRET
	};
}

export function authConfigured(): boolean {
	return authConfig() !== null;
}

/** Only allow same-origin, absolute paths as post-auth destinations. */
export function safeNext(value: string | null | undefined): string {
	if (!value) return '/';
	const next = value.trim();
	if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
	if (next.length > 512) return '/';
	for (const char of next) {
		const code = char.charCodeAt(0);
		if (code < 0x20 || code === 0x7f) return '/';
	}
	return next;
}

/** Add a sign-in result to a destination without losing its query or hash. */
export function authErrorLocation(next: string, reason: string): string {
	const url = new URL(safeNext(next), 'https://unblock.invalid');
	url.searchParams.set('auth', 'error');
	url.searchParams.set('reason', reason);
	return url.pathname + url.search + url.hash;
}

/** A plain 302 avoids any ambiguity between internal and external redirects. */
export function redirectResponse(location: string, status = 302): Response {
	return new Response(null, {
		status,
		headers: { location, 'cache-control': 'no-store' }
	});
}

/** --- session cookie (encrypted so the token is not readable by the browser) --- */

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
	return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function sealSession(session: Session, secret: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await encryptionKey(secret);
	const encrypted = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		new TextEncoder().encode(JSON.stringify(session))
	);
	return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(encrypted))}`;
}

function isSession(value: unknown): value is Session {
	if (typeof value !== 'object' || value === null) return false;
	const session = value as Partial<Session>;
	return (
		typeof session.token === 'string' &&
		session.token.length > 0 &&
		typeof session.login === 'string' &&
		session.login.length > 0 &&
		typeof session.avatarUrl === 'string' &&
		typeof session.issuedAt === 'number' &&
		Array.isArray(session.scopes) &&
		session.scopes.every((scope) => typeof scope === 'string')
	);
}

async function openSession(value: string, secret: string): Promise<Session | null> {
	try {
		const [version, iv, encrypted] = value.split('.');
		if (version !== 'v1' || !iv || !encrypted) return null;
		const key = await encryptionKey(secret);
		const decrypted = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: base64UrlDecode(iv) },
			key,
			base64UrlDecode(encrypted)
		);
		const parsed: unknown = JSON.parse(new TextDecoder().decode(decrypted));
		if (!isSession(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export async function readSession(cookies: Cookies): Promise<Session | null> {
	const config = authConfig();
	if (!config) return null;
	const raw = cookies.get(SESSION_COOKIE);
	if (!raw) return null;
	const session = await openSession(raw, config.sessionSecret);
	if (!session) return null;
	if (Date.now() - session.issuedAt > SESSION_MAX_AGE_SECONDS * 1000) return null;
	return session;
}

export async function writeSession(
	cookies: Cookies,
	user: SessionUser,
	token: string
): Promise<void> {
	const config = authConfig();
	if (!config) throw new Error('GitHub sign-in is not configured');
	const session: Session = { ...user, token, issuedAt: Date.now() };
	const value = await sealSession(session, config.sessionSecret);
	cookies.set(SESSION_COOKIE, value, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: SESSION_MAX_AGE_SECONDS
	});
}

export function clearSession(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

export function publicUser(session: Session): SessionUser {
	return {
		login: session.login,
		name: session.name,
		avatarUrl: session.avatarUrl,
		scopes: session.scopes
	};
}

/** --- OAuth state cookie --- */

export function writeOAuthState(cookies: Cookies, value: OAuthState): void {
	cookies.set(OAUTH_STATE_COOKIE, JSON.stringify(value), {
		path: '/auth/github',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: OAUTH_STATE_MAX_AGE_SECONDS
	});
}

export function readOAuthState(cookies: Cookies): OAuthState | null {
	const raw = cookies.get(OAUTH_STATE_COOKIE);
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return null;
		const value = parsed as Partial<OAuthState>;
		if (
			typeof value.state !== 'string' ||
			typeof value.next !== 'string' ||
			typeof value.privateRepos !== 'boolean'
		) {
			return null;
		}
		return {
			state: value.state,
			next: safeNext(value.next),
			privateRepos: value.privateRepos,
			write: value.write === true,
			projects: value.projects === true
		};
	} catch {
		return null;
	}
}

export function clearOAuthState(cookies: Cookies): void {
	cookies.delete(OAUTH_STATE_COOKIE, { path: '/auth/github' });
}

/** --- GitHub OAuth calls --- */

export interface OAuthAuthorizeOptions {
	privateRepos: boolean;
	/** Request write access so the board can edit issues. */
	write: boolean;
	/** Request read access to Projects v2 iteration fields. */
	projects: boolean;
}

export function oauthAuthorizeUrl(
	origin: string,
	state: string,
	options: OAuthAuthorizeOptions
): string {
	const config = authConfig();
	if (!config) throw new Error('GitHub sign-in is not configured');
	const url = new URL(GITHUB_AUTHORIZE_URL);
	url.searchParams.set('client_id', config.clientId);
	url.searchParams.set('redirect_uri', `${origin}/auth/github/callback`);
	url.searchParams.set('state', state);
	url.searchParams.set('allow_signup', 'true');
	// Private repos need the broad `repo` scope (GitHub OAuth Apps have no
	// read-only private scope), which also allows writes. Public-only editing
	// needs `public_repo`; plain reads request no scopes at all. Project
	// iterations are independent and need `read:project`.
	const scopes: string[] = [];
	if (options.privateRepos) scopes.push('repo');
	else if (options.write) scopes.push('public_repo');
	if (options.projects) scopes.push('read:project');
	if (scopes.length > 0) url.searchParams.set('scope', scopes.join(' '));
	return url.toString();
}

export async function exchangeCode(code: string, redirectUri: string): Promise<OAuthToken> {
	const config = authConfig();
	if (!config) throw new Error('GitHub sign-in is not configured');
	const response = await fetch(GITHUB_TOKEN_URL, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({
			client_id: config.clientId,
			client_secret: config.clientSecret,
			code,
			redirect_uri: redirectUri
		})
	});
	if (!response.ok) {
		throw new Error(`GitHub token exchange failed (${response.status})`);
	}
	const payload = await response.json<{
		access_token?: string;
		scope?: string;
		error?: string;
		error_description?: string;
	}>();
	if (!payload.access_token) {
		throw new Error(payload.error_description ?? payload.error ?? 'No access token returned');
	}
	return {
		token: payload.access_token,
		scopes: payload.scope ? payload.scope.split(/[,\s]+/).filter(Boolean) : []
	};
}

export interface GitHubProfile {
	login: string;
	name: string | null;
	avatarUrl: string;
	/** Authoritative scopes from `X-OAuth-Scopes`; null when GitHub omitted the header. */
	scopes: string[] | null;
}

export async function fetchGitHubUser(token: string): Promise<GitHubProfile> {
	const response = await fetch(GITHUB_API_USER_URL, {
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${token}`,
			'User-Agent': 'unblock',
			'X-GitHub-Api-Version': GITHUB_API_VERSION
		}
	});
	if (!response.ok) {
		throw new Error(`GitHub user lookup failed (${response.status})`);
	}
	const payload = await response.json<{
		login?: string;
		name?: string | null;
		avatar_url?: string;
	}>();
	if (!payload.login) throw new Error('GitHub user lookup returned no login');
	// The token exchange omits `scope` when GitHub reuses an existing token, so
	// read the granted scopes from the authenticated request instead.
	const scopeHeader = response.headers.get('x-oauth-scopes');
	return {
		login: payload.login,
		name: payload.name ?? null,
		avatarUrl: payload.avatar_url ?? '',
		scopes: scopeHeader === null ? null : scopeHeader.split(/[,\s]+/).filter(Boolean)
	};
}
