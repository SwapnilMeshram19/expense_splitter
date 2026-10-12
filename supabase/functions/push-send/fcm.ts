// Firebase Cloud Messaging (HTTP v1) with a service account, no SDK: a signed JWT is exchanged
// for a 1-hour OAuth token, then one POST per message. Free, no per-message charge.

import type { PushMessage } from '../_shared/domain/pushText.ts';

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TIMEOUT_MS = 10_000;

/** The JSON key file from Firebase (Project settings → Service accounts → Generate new private key). */
export function parseServiceAccount(text: string | null): ServiceAccount | null {
  if (!text) return null;
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    if (o.type !== 'service_account') return null;
    const { project_id: projectId, client_email: clientEmail, private_key: privateKey } = o;
    if (
      typeof projectId !== 'string' ||
      typeof clientEmail !== 'string' ||
      typeof privateKey !== 'string'
    )
      return null;
    if (!privateKey.includes('BEGIN PRIVATE KEY')) return null;
    return { projectId, clientEmail, privateKey };
  } catch {
    return null;
  }
}

const encoder = new TextEncoder();

export function base64Url(bytes: Uint8Array | string): string {
  const data = typeof bytes === 'string' ? encoder.encode(bytes) : bytes;
  let binary = '';
  for (const b of data) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/** RS256 JWT asking Google for an FCM access token. */
export async function signAssertion(account: ServiceAccount, nowSeconds: number): Promise<string> {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const key = await importPrivateKey(account.privateKey);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;
}

export async function getAccessToken(account: ServiceAccount): Promise<string> {
  const assertion = await signAssertion(account, Math.floor(Date.now() / 1000));
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: unknown;
    error?: unknown;
  };
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new Error(
      `token exchange failed: HTTP ${response.status} ${String(payload.error ?? '')}`,
    );
  }
  return payload.access_token;
}

/** FCM v1 request body for one device. */
export function fcmBody(token: string, message: PushMessage): unknown {
  return {
    message: {
      token,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: {
        priority: 'HIGH',
        notification: {
          channel_id: 'activity',
          ...(message.tag ? { tag: message.tag } : {}),
        },
      },
    },
  };
}

export type SendOutcome = 'ok' | 'dead' | 'failed';

/**
 * 'dead': the token will never work again (app uninstalled, signed out, data cleared): drop it.
 * Everything else that isn't 2xx is 'failed' (quota, server error, bad payload): kept, not retried.
 */
export function classifyFcmResponse(status: number, payload: unknown): SendOutcome {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 404) return 'dead';
  const error = (
    payload as { error?: { status?: unknown; message?: unknown; details?: unknown } } | null
  )?.error;
  const details = Array.isArray(error?.details) ? (error.details as { errorCode?: unknown }[]) : [];
  if (details.some((d) => d.errorCode === 'UNREGISTERED')) return 'dead';
  if (
    status === 400 &&
    error?.status === 'INVALID_ARGUMENT' &&
    /registration token/i.test(String(error.message ?? ''))
  ) {
    return 'dead';
  }
  return 'failed';
}

export async function sendFcm(
  account: ServiceAccount,
  accessToken: string,
  token: string,
  message: PushMessage,
): Promise<SendOutcome> {
  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(fcmBody(token, message)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    const payload = await response.json().catch(() => null);
    return classifyFcmResponse(response.status, payload);
  } catch {
    return 'failed';
  }
}
