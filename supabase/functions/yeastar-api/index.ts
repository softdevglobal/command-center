// Supabase Edge Function: yeastar-api proxy
// Hides PBX credentials from the browser. The proxy holds privileged PBX
// credentials, so callers must present a valid dashboard session and may only
// reach the PBX Open API surface.

import { corsHeadersFor, preflightResponse } from '../_shared/cors.ts'
import { resolveCaller } from '../_shared/auth.ts'

const OPENAPI = '/openapi/v1.0'

/** Never proxy arbitrary PBX paths — the dashboard only uses Open API routes. */
const ALLOWED_ENDPOINT_PREFIX = '/openapi/'

type PbxCred = { id: string; key: string; label: string }

function listPbxCredentials(): PbxCred[] {
  const pairs: [string, string, string][] = [
    ['YEASTAR_OPENAPI_ACCESS_ID', 'YEASTAR_OPENAPI_ACCESS_KEY', 'openapi'],
    ['YEASTAR_CLIENT_ID', 'YEASTAR_CLIENT_SECRET', 'client'],
    ['YEASTAR_SDK_ACCESS_ID', 'YEASTAR_SDK_ACCESS_KEY', 'sdk'],
  ]
  const out: PbxCred[] = []
  for (const [idK, keyK, label] of pairs) {
    const id = Deno.env.get(idK)?.trim()
    const key = Deno.env.get(keyK)?.trim()
    if (id && key) out.push({ id, key, label })
  }
  return out
}

/** Match client `extractYeastarRecordingFileKey` — DB stores full `/cdr_recording/recording/…` URLs. */
function extractRecordingFileKey(recordingPath: string): string {
  const raw = recordingPath.trim()
  if (!raw) throw new Error('Empty recording path')

  try {
    const u = /^https?:\/\//i.test(raw)
      ? new URL(raw)
      : new URL(raw, 'http://recording.invalid/')

    const fromQuery =
      u.searchParams.get('recording') ?? u.searchParams.get('file')
    if (fromQuery?.trim()) return fromQuery.trim()

    let path = decodeURIComponent(u.pathname.replace(/^\/+/, ''))
    const prefix = 'cdr_recording/recording/'
    if (path.startsWith(prefix)) path = path.slice(prefix.length)
    if (path) return path
  } catch {
    /* bare filename */
  }
  return raw.replace(/^\/+/, '')
}

async function fetchPbxAccessTokenForCred(
  pbxBase: string,
  c: PbxCred,
): Promise<string | null> {
  try {
    const res = await fetch(`${pbxBase}${OPENAPI}/get_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'CommandCentre/1.0',
      },
      body: JSON.stringify({ username: c.id, password: c.key }),
    })
    const data = await res.json()
    if (data?.errcode === 0 && typeof data?.access_token === 'string') {
      return data.access_token
    }
    console.warn(
      `[yeastar-api] get_token (${c.label}) errcode=${data?.errcode} ${data?.errmsg ?? ''}`,
    )
  } catch (e) {
    console.warn(`[yeastar-api] get_token (${c.label}) failed:`, e)
  }
  return null
}

function isNonAudioContentType(ct: string): boolean {
  const l = ct.toLowerCase()
  return (
    l.includes('application/json') ||
    l.includes('text/html') ||
    (l.includes('text/') && !l.startsWith('audio/'))
  )
}

/**
 * Open API: recording/download → download_resource_url → stream WAV/MP3 bytes.
 */
async function fetchPbxRecordingUpstream(
  pbxBase: string,
  recordingPath: string,
  token: string,
): Promise<Response> {
  const fileKey = extractRecordingFileKey(recordingPath)
  const qs = /^\d+$/.test(fileKey)
    ? new URLSearchParams({ id: fileKey, access_token: token })
    : new URLSearchParams({ file: fileKey, access_token: token })

  const metaUrl = `${pbxBase}${OPENAPI}/recording/download?${qs}`
  console.log(`[yeastar-api] recording/download file=${fileKey.slice(0, 80)}`)

  const metaRes = await fetch(metaUrl, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'CommandCentre/1.0',
    },
  })

  const meta = await metaRes.json().catch(() => null)
  if (!meta || typeof meta !== 'object') {
    throw Object.assign(new Error('Recording metadata response invalid'), { errcode: -1 })
  }

  const errcode = meta.errcode as number | undefined
  if (typeof errcode === 'number' && errcode !== 0) {
    const msg = String(meta.errmsg ?? 'unknown')
    throw Object.assign(new Error(`PBX recording/download ${errcode}: ${msg}`), { errcode })
  }

  const rel = meta.download_resource_url
  if (typeof rel !== 'string' || !rel.trim()) {
    throw Object.assign(new Error('PBX recording/download missing download_resource_url'), {
      errcode: -1,
    })
  }

  const path = rel.startsWith('/') ? rel : `/${rel}`
  const sep = path.includes('?') ? '&' : '?'
  const downloadUrl = `${pbxBase}${path}${sep}access_token=${encodeURIComponent(token)}`

  return fetch(downloadUrl, {
    headers: {
      Accept: 'audio/wav,audio/mpeg,audio/*,*/*',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'CommandCentre/1.0',
    },
  })
}

/** Try Supabase-configured Open API apps before the dashboard token (often Linkus SDK without Recording scope). */
async function streamRecordingWithCredentialRotation(
  pbxBase: string,
  recordingPath: string,
  clientToken: string,
): Promise<Response> {
  const denied: string[] = []
  const tokens: { token: string; label: string }[] = []
  const seen = new Set<string>()

  for (const c of listPbxCredentials()) {
    const t = await fetchPbxAccessTokenForCred(pbxBase, c)
    if (t && !seen.has(t)) {
      seen.add(t)
      tokens.push({ token: t, label: `server:${c.label}` })
    }
  }

  const ct = clientToken.trim()
  if (ct && !seen.has(ct)) {
    tokens.push({ token: ct, label: 'dashboard token' })
  }

  if (tokens.length === 0) {
    throw Object.assign(
      new Error(
        'No PBX credentials available. Set YEASTAR_OPENAPI_ACCESS_ID/KEY (or CLIENT/SDK) as Supabase secrets, or the dashboard must supply an access_token.',
      ),
      { errcode: -1 },
    )
  }

  let lastErr: { errcode?: number; message: string } | null = null

  for (const { token, label } of tokens) {
    try {
      const upstream = await fetchPbxRecordingUpstream(pbxBase, recordingPath, token)
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '')
        lastErr = { message: `audio HTTP ${upstream.status}: ${detail.slice(0, 200)}` }
        continue
      }
      const rawCt = upstream.headers.get('content-type') || ''
      if (isNonAudioContentType(rawCt)) {
        lastErr = { message: `non-audio ${rawCt}` }
        continue
      }
      return upstream
    } catch (e) {
      const errcode = (e as { errcode?: number }).errcode
      const message = e instanceof Error ? e.message : String(e)
      lastErr = { errcode, message }
      if (errcode === 10005) {
        denied.push(label)
        continue
      }
      throw e
    }
  }

  const uniqDenied = [...new Set(denied)]
  if (uniqDenied.length > 0 && uniqDenied.length === tokens.length) {
    throw Object.assign(
      new Error(
        `Recording → Download denied (10005) for every token tried: ${uniqDenied.join(', ')}.`,
      ),
      { errcode: 10005, denied: uniqDenied },
    )
  }

  throw Object.assign(new Error(lastErr?.message ?? 'Recording stream failed'), {
    errcode: lastErr?.errcode,
  })
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req, 'POST, GET, OPTIONS')

  const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  const audioResponseFromUpstream = (upstream: Response): Response => {
    const rawCt = upstream.headers.get('content-type') || ''
    const out = new Headers(corsHeaders)
    if (rawCt) out.set('Content-Type', rawCt)
    const cl = upstream.headers.get('content-length')
    if (cl) out.set('Content-Length', cl)
    return new Response(upstream.body, { status: upstream.status, headers: out })
  }

  if (req.method === 'OPTIONS') {
    return preflightResponse(req, 'POST, GET, OPTIONS')
  }

  const caller = await resolveCaller(req)
  if (!caller) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  try {
    const PBX_URL = Deno.env.get('YEASTAR_PBX_URL') || ''
    if (!PBX_URL) {
      console.error('[yeastar-api] ERROR: YEASTAR_PBX_URL secret is missing')
      return jsonResponse({ error: 'PBX URL not configured on server' }, 500)
    }

    const pbxBase = PBX_URL.replace(/\/$/, '')
    const bodyData = await req.json()

    /** End-to-end recording stream (Open API download path — not raw /cdr_recording/). */
    const streamReq = bodyData.stream_recording
    if (streamReq) {
      const recordingPath =
        typeof streamReq === 'string'
          ? streamReq
          : String(streamReq.recording_path ?? streamReq.recordingPath ?? '').trim()
      const providedToken = String(
        (typeof streamReq === 'object'
          ? streamReq.access_token ?? streamReq.accessToken
          : '') ||
          bodyData.access_token ||
          '',
      ).trim()

      if (!recordingPath) {
        return jsonResponse({ error: 'Missing recording_path' }, 400)
      }

      if (!providedToken && listPbxCredentials().length === 0) {
        return jsonResponse(
          {
            error: 'No PBX access token',
            hint:
              'Set YEASTAR_OPENAPI_ACCESS_* (or SDK/CLIENT) Supabase secrets, or pass access_token from the dashboard.',
          },
          401,
        )
      }

      try {
        const upstream = await streamRecordingWithCredentialRotation(
          pbxBase,
          recordingPath,
          providedToken,
        )
        return audioResponseFromUpstream(upstream)
      } catch (e) {
        const errcode = (e as { errcode?: number }).errcode
        const denied = (e as { denied?: string[] }).denied
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[yeastar-api] stream_recording failed:', msg)

        if (errcode === 10005) {
          return jsonResponse(
            {
              error: 'Open API lacks Recording → Download permission',
              errcode: 10005,
              denied: denied ?? [],
              hint:
                'Yeastar PBX → Integrations → API → each app listed in "denied" → Permissions → Recording → Download. Linkus SDK apps usually need a separate Open API app for recordings.',
            },
            403,
          )
        }

        return jsonResponse({ error: msg, errcode: errcode ?? undefined }, 502)
      }
    }

    /** Stream authenticated PBX `/api/download/…` URLs to the browser (legacy relay). */
    const relayFromPbx =
      typeof bodyData.relay_from_pbx === 'string'
        ? bodyData.relay_from_pbx.trim()
        : ''

    if (relayFromPbx) {
      let target: URL
      try {
        target = new URL(relayFromPbx)
      } catch {
        return jsonResponse({ error: 'Invalid relay URL' }, 400)
      }

      const allowedOrigin = new URL(pbxBase).origin
      if (target.origin !== allowedOrigin) {
        return jsonResponse({ error: 'relay target origin not allowed' }, 403)
      }

      const safeLogged = `${target.pathname}${target.search ? '?…' : ''}`
      console.log(`[yeastar-api] Relay stream from PBX: ${safeLogged}`)

      const accessToken =
        target.searchParams.get('access_token') ??
        target.searchParams.get('token') ??
        ''

      const upstreamHeaders: Record<string, string> = {
        Accept: 'audio/wav,audio/mpeg,audio/*,*/*',
        'User-Agent': 'CommandCentre/1.0',
      }
      if (accessToken) {
        upstreamHeaders.Authorization = `Bearer ${accessToken}`
      }

      const upstream = await fetch(relayFromPbx, {
        method: 'GET',
        headers: upstreamHeaders,
      })

      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '')
        console.error(`[yeastar-api] Relay PBX HTTP ${upstream.status}: ${detail.slice(0, 400)}`)
        return jsonResponse(
          {
            error: 'PBX recording fetch failed',
            pbx_status: upstream.status,
            detail: detail.slice(0, 800),
          },
          502,
        )
      }

      const rawCt = upstream.headers.get('content-type') || ''
      if (isNonAudioContentType(rawCt)) {
        const detail = await upstream.text()
        console.error(`[yeastar-api] Relay expected audio, got ${rawCt}: ${detail.slice(0, 400)}`)
        return jsonResponse(
          {
            error: 'PBX returned non-audio body (bad token or URL?)',
            hint:
              'Use stream_recording (Open API /recording/download). Raw /cdr_recording/… URLs need a portal session.',
            content_type: rawCt,
            detail: detail.slice(0, 800),
          },
          502,
        )
      }

      return audioResponseFromUpstream(upstream)
    }

    const { endpoint, method, body, params, headers: customHeaders } = bodyData

    if (!endpoint || typeof endpoint !== 'string') {
      return jsonResponse({ error: 'Missing endpoint' }, 400)
    }

    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`

    if (!path.startsWith(ALLOWED_ENDPOINT_PREFIX) || path.includes('..')) {
      console.warn(`[yeastar-api] Rejected endpoint from ${caller.id}: ${path.slice(0, 120)}`)
      return jsonResponse({ error: 'Endpoint not allowed' }, 403)
    }
    let finalUrl = `${pbxBase}${path}`

    if (params) {
      const qs = new URLSearchParams()
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          qs.append(key, String(value))
        }
      })
      const queryString = qs.toString()
      if (queryString) {
        finalUrl += (finalUrl.includes('?') ? '&' : '?') + queryString
      }
    }

    const loggedUrl = new URL(finalUrl)
    if (loggedUrl.searchParams.has('access_token')) {
      loggedUrl.searchParams.set('access_token', '…')
    }
    console.log(`[yeastar-api] Forwarding to: ${method || 'GET'} ${loggedUrl.toString()}`)

    const pbxHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'CommandCentre/1.0',
    }

    if (customHeaders?.Authorization) {
      pbxHeaders.Authorization = customHeaders.Authorization
    } else if (customHeaders?.authorization) {
      pbxHeaders.Authorization = customHeaders.authorization
    }

    const response = await fetch(finalUrl, {
      method: method || 'GET',
      headers: pbxHeaders,
      ...(body ? { body: JSON.stringify(body) } : {}),
    })

    console.log(`[yeastar-api] PBX response status: ${response.status}`)

    const contentType = response.headers.get('content-type') || ''
    let responseData
    if (contentType.includes('application/json')) {
      responseData = await response.json()
    } else {
      const text = await response.text()
      try {
        responseData = JSON.parse(text)
      } catch {
        responseData = { text }
      }
    }

    return jsonResponse(responseData, response.status)
  } catch (error) {
    console.error('[yeastar-api] UNCAUGHT ERROR:', error.message)
    return jsonResponse({ error: error.message }, 500)
  }
})
