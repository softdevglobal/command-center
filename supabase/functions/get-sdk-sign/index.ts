declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

import { corsHeadersFor, preflightResponse } from '../_shared/cors.ts';
import { resolveCaller } from '../_shared/auth.ts';

// ═══════════════════════════════════════════════════════════
// get-sdk-sign — Supabase Edge Function
// Generates a Yeastar Linkus SDK login signature for a given
// agent email. The sign is required to initialise the
// ys-webrtc-sdk-core WebRTC softphone in the browser.
//
// A sign is a PBX login credential, so the caller must hold a
// valid dashboard session and may only mint one for their own
// extension unless they are an admin or supervisor.
//
// Secrets to set (npx supabase secrets set):
//   YEASTAR_PBX_URL         e.g. https://mypbx.ras.yeastar.com
//   YEASTAR_SDK_ACCESS_ID   Linkus SDK → AccessID
//   YEASTAR_SDK_ACCESS_KEY  Linkus SDK → AccessKey
// ═══════════════════════════════════════════════════════════

const PBX_URL = (Deno.env.get('YEASTAR_PBX_URL') ?? '').replace(/\/$/, '');
const SDK_ACCESS_ID = Deno.env.get('YEASTAR_SDK_ACCESS_ID') ?? '';
const SDK_ACCESS_KEY = Deno.env.get('YEASTAR_SDK_ACCESS_KEY') ?? '';

const ELEVATED_ROLES = new Set(['super-admin', 'client-admin', 'supervisor']);

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req, 'POST, OPTIONS');
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') {
    return preflightResponse(req, 'POST, OPTIONS');
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const caller = await resolveCaller(req);
  if (!caller) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let email: unknown;
  try {
    const body = await req.json();
    email = body?.email;
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }

  if (typeof email !== 'string' || !email.includes('@')) {
    return json({ error: 'Invalid request' }, 400);
  }

  const requested = email.trim().toLowerCase();
  const own = (caller.email ?? '').trim().toLowerCase();
  if (requested !== own && !ELEVATED_ROLES.has(caller.role ?? '')) {
    return json({ error: 'Forbidden' }, 403);
  }

  if (!PBX_URL || !SDK_ACCESS_ID || !SDK_ACCESS_KEY) {
    console.error('[get-sdk-sign] Missing Yeastar SDK secrets');
    return json({ error: 'Service unavailable' }, 503);
  }

  try {
    // ── Step 1: Obtain PBX access token ──────────────────────
    const tokenRes = await fetch(`${PBX_URL}/openapi/v1.0/get_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: SDK_ACCESS_ID,
        password: SDK_ACCESS_KEY,
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`PBX token endpoint returned HTTP ${tokenRes.status}`);
    }

    const tokenData: { errcode: number; errmsg: string; access_token?: string } =
      await tokenRes.json();

    if (tokenData.errcode !== 0 || !tokenData.access_token) {
      throw new Error(`PBX token error ${tokenData.errcode}: ${tokenData.errmsg}`);
    }

    const accessToken = tokenData.access_token;

    // ── Step 2: Create SDK sign for the agent's email ─────────
    const signRes = await fetch(
      `${PBX_URL}/openapi/v1.0/sign/create?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: requested,
          sign_type: 'sdk',
          expire_time: 0,
        }),
      }
    );

    if (!signRes.ok) {
      throw new Error(`PBX sign endpoint returned HTTP ${signRes.status}`);
    }

    const signData: {
      errcode: number;
      errmsg: string;
      data?: { sign?: string };
    } = await signRes.json();

    if (signData.errcode !== 0 || !signData.data?.sign) {
      throw new Error(`PBX sign error ${signData.errcode}: ${signData.errmsg}`);
    }

    return json({ sign: signData.data.sign });
  } catch (err) {
    // Upstream PBX detail stays in the function logs, never in the response.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[get-sdk-sign] ${msg}`);
    return json({ error: 'Could not create softphone signature' }, 502);
  }
});
