import { createAdminClient } from '@/lib/supabase/admin'
import type { QboConnection, QboEnvironment } from '@/lib/supabase/types/database'
import { BASE_PATH } from '@/lib/basePath'
import { siteOrigin } from '@/lib/site-url'

/**
 * QuickBooks Online OAuth + API plumbing.
 *
 * The single qbo_connection row holds the tokens for the one QuickBooks
 * company we sync to. Access tokens last ~1 hour and are refreshed on use;
 * refresh tokens rotate and last ~100 days, so any sync activity keeps the
 * connection alive indefinitely.
 */

export class QboError extends Error {}

export const QBO_SCOPE = 'com.intuit.quickbooks.accounting'
export const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const QBO_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'
// Intuit's minimum supported minor version
const QBO_MINOR_VERSION = '75'

export function qboConfig() {
  const clientId = process.env.QBO_CLIENT_ID
  const clientSecret = process.env.QBO_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  const environment: QboEnvironment =
    process.env.QBO_ENVIRONMENT === 'production' ? 'production' : 'sandbox'
  return { clientId, clientSecret, environment }
}

/**
 * OAuth redirect URI — must exactly match a URI registered in the Intuit app.
 * QBO_REDIRECT_URI wins; otherwise the public origin (NEXT_PUBLIC_SITE_URL,
 * else the request's) plus the base path.
 */
export function qboRedirectUri(origin: string): string {
  return (
    process.env.QBO_REDIRECT_URI ?? `${siteOrigin(origin)}${BASE_PATH}/api/quickbooks/callback`
  )
}

export function qboApiBase(environment: QboEnvironment): string {
  return environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com'
}

function basicAuthHeader(): string {
  const cfg = qboConfig()
  if (!cfg) throw new QboError('QuickBooks keys not configured (QBO_CLIENT_ID / QBO_CLIENT_SECRET)')
  return `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`
}

type TokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  x_refresh_token_expires_in: number
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params).toString(),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new QboError(`Token request failed (${res.status}): ${body.slice(0, 300)}`)
  }
  return (await res.json()) as TokenResponse
}

export async function exchangeAuthCode(code: string, redirectUri: string): Promise<TokenResponse> {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
}

function tokenExpiryFields(tokens: TokenResponse) {
  const now = Date.now()
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    access_token_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
    refresh_token_expires_at: new Date(now + tokens.x_refresh_token_expires_in * 1000).toISOString(),
  }
}

export async function storeConnection(params: {
  tokens: TokenResponse
  realmId: string
  companyName: string | null
  connectedBy: string | null
}): Promise<void> {
  const cfg = qboConfig()
  if (!cfg) throw new QboError('QuickBooks keys not configured')
  const supabase = createAdminClient()
  const { error } = await supabase.from('qbo_connection').upsert({
    id: 1,
    environment: cfg.environment,
    realm_id: params.realmId,
    company_name: params.companyName,
    connected_by: params.connectedBy,
    connected_at: new Date().toISOString(),
    ...tokenExpiryFields(params.tokens),
  })
  if (error) throw new QboError(`Failed to store connection: ${error.message}`)
}

export async function getConnection(): Promise<QboConnection | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('qbo_connection').select('*').eq('id', 1).maybeSingle()
  return data ?? null
}

/**
 * Return the connection with a currently-valid access token, refreshing (and
 * persisting the rotated tokens) if it expires in the next 3 minutes.
 * Returns null when no company has been connected.
 */
export async function getValidConnection(): Promise<QboConnection | null> {
  const conn = await getConnection()
  if (!conn) return null

  if (new Date(conn.refresh_token_expires_at).getTime() < Date.now()) {
    throw new QboError(
      'The QuickBooks connection has expired. Reconnect from Settings.'
    )
  }

  if (new Date(conn.access_token_expires_at).getTime() > Date.now() + 3 * 60 * 1000) {
    return conn
  }
  return refreshConnection(conn)
}

async function refreshConnection(conn: QboConnection): Promise<QboConnection> {
  const tokens = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: conn.refresh_token,
  })
  const fields = tokenExpiryFields(tokens)
  const supabase = createAdminClient()
  const { error } = await supabase.from('qbo_connection').update(fields).eq('id', 1)
  if (error) throw new QboError(`Failed to persist refreshed tokens: ${error.message}`)
  return { ...conn, ...fields }
}

/** Best-effort token revocation + delete the stored connection. */
export async function disconnect(): Promise<void> {
  const conn = await getConnection()
  if (conn) {
    try {
      await fetch(QBO_REVOKE_URL, {
        method: 'POST',
        headers: {
          Authorization: basicAuthHeader(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ token: conn.refresh_token }),
      })
    } catch {
      // Revocation is best-effort; the row delete below is what disconnects us.
    }
  }
  const supabase = createAdminClient()
  await supabase.from('qbo_connection').delete().eq('id', 1)
}

/**
 * Authenticated fetch against the connected company. `path` is relative to
 * /v3/company/{realmId}/ (e.g. 'purchase', "query?query=..."). Retries once
 * on 401 after a forced refresh.
 */
export async function qboFetch(
  conn: QboConnection,
  path: string,
  init: RequestInit = {},
  retried = false
): Promise<Response> {
  const sep = path.includes('?') ? '&' : '?'
  const url = `${qboApiBase(conn.environment)}/v3/company/${conn.realm_id}/${path}${sep}minorversion=${QBO_MINOR_VERSION}`
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      Accept: 'application/json',
      ...(init.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init.headers,
    },
  })
  if (res.status === 401 && !retried) {
    const refreshed = await refreshConnection(conn)
    return qboFetch(refreshed, path, init, true)
  }
  return res
}

export async function qboJson<T>(conn: QboConnection, path: string, init: RequestInit = {}): Promise<T> {
  const res = await qboFetch(conn, path, init)
  const text = await res.text()
  if (!res.ok) {
    throw new QboError(`QuickBooks API error (${res.status}) on ${path.split('?')[0]}: ${text.slice(0, 500)}`)
  }
  return JSON.parse(text) as T
}
