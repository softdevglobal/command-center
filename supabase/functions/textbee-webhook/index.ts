declare const Deno: {

  env: {

    get(key: string): string | undefined;

  };

  serve(handler: (req: Request) => Response | Promise<Response>): void;

};



// @ts-expect-error Supabase Edge Functions resolve this remote ESM import at runtime.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import {

  canonicalSmsPhone,

  normalizeTextBeePayload,

  persistInboundSms,

  shouldSkipTextBeeWebhookEvent,

  verifyTextBeeWebhookAuth,

} from "../_shared/textbeeInbound.ts";



// Provider-to-provider webhook: no browser ever calls it, so no origin is
// allowed. Advertising CORS here would only widen the surface.
const corsHeaders = {

  "Access-Control-Allow-Methods": "POST, OPTIONS",

  "Access-Control-Allow-Headers":

    "authorization, x-client-info, apikey, content-type, x-textbee-secret, x-webhook-secret, x-signature, x-textbee-signature",

  "Access-Control-Max-Age": "86400",

};



function json(body: unknown, status = 200): Response {

  return new Response(JSON.stringify(body), {

    status,

    headers: { ...corsHeaders, "Content-Type": "application/json" },

  });

}



Deno.serve(async (req) => {

  if (req.method === "OPTIONS") {

    return new Response("ok", { status: 200, headers: corsHeaders });

  }



  if (req.method !== "POST") {

    return json({ error: "Method not allowed" }, 405);

  }



  let body: unknown;

  try {

    body = await req.json();

  } catch {

    return json({ error: "Invalid JSON body" }, 400);

  }



  const webhookSecret = Deno.env.get("TEXTBEE_WEBHOOK_SECRET")?.trim();

  const authorized = await verifyTextBeeWebhookAuth(req, body, webhookSecret);

  if (!authorized) {

    console.warn("[textbee-webhook] unauthorized — check TEXTBEE_WEBHOOK_SECRET and TextBee X-Signature");

    return json({ error: "Invalid webhook secret or signature" }, 401);

  }



  const inbound = normalizeTextBeePayload(body);

  if (shouldSkipTextBeeWebhookEvent(inbound.event)) {

    return json({ ok: true, skipped: inbound.event || "non-inbound" });

  }



  if (!inbound.phone || !inbound.messageBody) {

    console.warn("[textbee-webhook] rejected payload", JSON.stringify(body).slice(0, 500));

    return json({ error: "Missing sender phone or message body" }, 400);

  }

  inbound.phone = canonicalSmsPhone(inbound.phone);



  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);



  try {

    const result = await persistInboundSms(supabaseAdmin, inbound);

    if (result.duplicate) {

      return json({ ok: true, duplicate: true, threadId: result.threadId });

    }

    return json({ ok: true, threadId: result.threadId, messageId: result.messageId });

  } catch (error) {

    console.error("[textbee-webhook] failed", error);

    return json({ error: error instanceof Error ? error.message : "Webhook failed" }, 500);

  }

});

