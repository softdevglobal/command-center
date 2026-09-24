#!/usr/bin/env node
/**
 * Security remediation retest.
 *
 * Reproduces the checks from the external review so fixes can be verified and
 * re-verified after every deploy:
 *
 *   npm run security:retest
 *   APP_URL=https://staging.example npm run security:retest
 *
 * Supabase credentials are read from the environment, falling back to .env.
 * Only the public publishable key is needed — never the service role key.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
      if (!match) continue;
      out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

const fileEnv = loadDotEnv();
const env = (key) => process.env[key] ?? fileEnv[key];

const APP_URL = (env('APP_URL') ?? 'https://commandcenter.bmspros.com.au').replace(/\/+$/, '');
const SUPABASE_URL = (env('SUPABASE_URL') ?? env('VITE_SUPABASE_URL') ?? '').replace(/\/+$/, '');
const SUPABASE_KEY =
  env('SUPABASE_PUBLISHABLE_KEY') ??
  env('VITE_SUPABASE_PUBLISHABLE_KEY') ??
  env('VITE_SUPABASE_ANON_KEY') ??
  '';

/** Tables that must never be readable with the public publishable key. */
const PRIVATE_TABLES = [
  'bms_bookings',
  'bookings',
  'customers',
  'vehicles',
  'agents',
  'profiles',
  'tenants',
  'user_roles',
];

const REQUIRED_HEADERS = [
  'content-security-policy',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'strict-transport-security',
];

const SPA_ROUTES = ['/', '/login', '/admin', '/agent', '/bookings/dashboard'];

const SECRET_LEAK_PATTERNS = [/SETUP_SECRET_KEY/i, /x-setup-secret/i];

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const label = ok ? 'PASS' : 'FAIL';
  console.log(`${label}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function probe(url, init) {
  try {
    const res = await fetch(url, { redirect: 'manual', ...init });
    const body = await res.text().catch(() => '');
    return { res, body };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** 1. Anonymous Supabase reads must return no rows. */
async function checkAnonymousTableReads() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    record('Supabase anon read', false, 'set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY');
    return;
  }

  for (const table of PRIVATE_TABLES) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`;
    const { res, body, error } = await probe(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });

    if (error) {
      record(`Supabase anon read: ${table}`, false, error);
      continue;
    }

    // A privilege error is also an acceptable outcome — the point is "no rows".
    if (res.status === 401 || res.status === 403) {
      record(`Supabase anon read: ${table}`, true, `blocked (HTTP ${res.status})`);
      continue;
    }

    let rows;
    try {
      rows = JSON.parse(body);
    } catch {
      record(`Supabase anon read: ${table}`, false, `unparseable body (HTTP ${res.status})`);
      continue;
    }

    const leaked = Array.isArray(rows) ? rows.length : 1;
    record(
      `Supabase anon read: ${table}`,
      leaked === 0,
      leaked === 0 ? 'empty result' : `${leaked} row(s) exposed`,
    );
  }
}

/** 4. Security headers on every SPA route. */
async function checkSecurityHeaders() {
  for (const route of SPA_ROUTES) {
    const { res, error } = await probe(`${APP_URL}${route}`);
    if (error) {
      record(`Security headers: ${route}`, false, error);
      continue;
    }

    const missing = REQUIRED_HEADERS.filter((h) => !res.headers.get(h));
    const csp = res.headers.get('content-security-policy') ?? '';
    const framed = !/frame-ancestors\s+'none'/i.test(csp) && !res.headers.get('x-frame-options');
    if (framed) missing.push('frame protection');

    record(
      `Security headers: ${route}`,
      missing.length === 0,
      missing.length === 0 ? 'all present' : `missing ${missing.join(', ')}`,
    );
  }
}

/** 2 & 6. Public API surface must not describe itself. */
async function checkApiDisclosure() {
  const catalogueMarkers = [
    /"endpoints"/i,
    /"routes"/i,
    /\/api\/agents/i,
    /webhook/i,
    /firebase/i,
    /firestore/i,
    /super-admin/i,
  ];

  const targets = [
    { path: '/api', name: 'GET /api route catalogue' },
    { path: '/api/health/db', name: 'GET /api/health/db dependency detail' },
  ];

  for (const { path, name } of targets) {
    const { res, body, error } = await probe(`${APP_URL}${path}`);
    if (error) {
      record(name, false, error);
      continue;
    }

    const hits = catalogueMarkers.filter((re) => re.test(body)).map(String);
    record(
      name,
      hits.length === 0,
      hits.length === 0 ? `HTTP ${res.status}, no disclosure` : `discloses ${hits.join(' ')}`,
    );
  }
}

/** 3 & 8. Privileged endpoints: authenticate first, stay generic. */
async function checkPrivilegedEndpoints() {
  const targets = ['/api/super-admin/register', '/api/agents/register'];

  for (const path of targets) {
    const { res, body, error } = await probe(`${APP_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    if (error) {
      record(`POST ${path}`, false, error);
      continue;
    }

    const leaksSecret = SECRET_LEAK_PATTERNS.some((re) => re.test(body));
    const describesPayload = /required|must be|invalid .*(field|body)/i.test(body);
    const authFirst = res.status === 401 || res.status === 403;

    const problems = [];
    if (leaksSecret) problems.push('mentions setup secret');
    if (describesPayload) problems.push('describes payload before auth');
    if (!authFirst) problems.push(`expected 401/403, got ${res.status}`);

    record(
      `POST ${path}`,
      problems.length === 0,
      problems.length === 0 ? `HTTP ${res.status}, generic` : problems.join('; '),
    );
  }
}

/** 5. Untrusted origins must not be allowed through CORS. */
async function checkCors() {
  const attacker = 'https://example-attacker-site.test';
  const { res, error } = await probe(`${APP_URL}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: attacker,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });

  if (error) {
    record('CORS preflight from untrusted origin', false, error);
    return;
  }

  const allowed = res.headers.get('access-control-allow-origin');
  const bad = allowed === '*' || allowed === attacker;
  record(
    'CORS preflight from untrusted origin',
    !bad,
    bad ? `allow-origin: ${allowed}` : `allow-origin: ${allowed ?? 'not sent'}`,
  );
}

/** 9. Sensitive-looking paths should not return the app shell. */
async function checkSensitivePaths() {
  const paths = ['/.env', '/.env.local', '/package.json', '/vercel.json', '/src/main.tsx'];

  for (const path of paths) {
    const { res, body, error } = await probe(`${APP_URL}${path}`);
    if (error) {
      record(`Sensitive path ${path}`, false, error);
      continue;
    }

    const servedHtml = res.status === 200 && /<div id="root">|<!doctype html>/i.test(body);
    record(
      `Sensitive path ${path}`,
      !servedHtml,
      servedHtml ? 'returns 200 app shell' : `HTTP ${res.status}`,
    );
  }
}

/** 10. security.txt must exist as plain text. */
async function checkSecurityTxt() {
  const { res, body, error } = await probe(`${APP_URL}/.well-known/security.txt`);
  if (error) {
    record('/.well-known/security.txt', false, error);
    return;
  }

  const contentType = res.headers.get('content-type') ?? '';
  const problems = [];
  if (res.status !== 200) problems.push(`HTTP ${res.status}`);
  if (!contentType.includes('text/plain')) problems.push(`content-type ${contentType || 'missing'}`);
  if (!/^Contact:/m.test(body)) problems.push('no Contact field');
  if (!/^Expires:/m.test(body)) problems.push('no Expires field');

  record(
    '/.well-known/security.txt',
    problems.length === 0,
    problems.length === 0 ? 'valid text/plain' : problems.join('; '),
  );
}

async function main() {
  console.log(`Target app:      ${APP_URL}`);
  console.log(`Supabase project: ${SUPABASE_URL || '(not configured)'}\n`);

  await checkAnonymousTableReads();
  await checkSecurityHeaders();
  await checkApiDisclosure();
  await checkPrivilegedEndpoints();
  await checkCors();
  await checkSensitivePaths();
  await checkSecurityTxt();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

  if (failed.length > 0) {
    console.log('\nOutstanding:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
