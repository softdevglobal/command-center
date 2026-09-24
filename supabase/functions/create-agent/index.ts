declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

// @ts-ignore Supabase Edge Functions resolve this remote ESM import at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { baseCorsHeaders, serveWithCors } from "../_shared/cors.ts";

const ALLOWED_METHODS = "POST, OPTIONS";
const corsHeaders = baseCorsHeaders(ALLOWED_METHODS);

type AgentColumn = {
  column_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  udt_name: string;
};

Deno.serve(serveWithCors(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Verify caller is super-admin or client-admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: caller },
    } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check caller role
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .single();

    if (!roleData || !["super-admin", "client-admin"].includes(roleData.role)) {
      return new Response(
        JSON.stringify({ error: "Insufficient permissions" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const body = await req.json();
    const {
      name,
      email,
      phone,
      password,
      extension = "",
      notes = "",
      agentType: agentTypeRaw = "workshop",
      tenantId: tenantIdRaw = "",
      workshopOwnerUid: workshopOwnerUidRaw = "",
      workshopBranchId: workshopBranchIdRaw = "",
      workshopUserRole: workshopUserRoleRaw = "",
    } = body;

    if (!name || !email || !password) {
      return new Response(
        JSON.stringify({ error: "name, email, and password are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const tenantId = String(tenantIdRaw ?? "").trim();
    const agentType =
      String(agentTypeRaw ?? "").trim() === "command-centre"
        ? "command-centre"
        : "workshop";
    const workshopOwnerUid = String(workshopOwnerUidRaw ?? "").trim();
    const workshopBranchId = String(workshopBranchIdRaw ?? "").trim();
    const workshopUserRole = String(workshopUserRoleRaw ?? "").trim();

    if (!String(extension ?? "").trim()) {
      return new Response(
        JSON.stringify({
          error:
            "extension is required — use the Yeastar extension number for this agent.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (agentType === "workshop" && !workshopOwnerUid) {
      return new Response(
        JSON.stringify({
          error:
            "workshopOwnerUid is required — choose a workshop from BMS.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (agentType === "workshop" && !workshopBranchId) {
      return new Response(
        JSON.stringify({
          error:
            "workshopBranchId is required — choose a workshop branch.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const allowedWorkshopRoles = ["owner", "branch_admin", "staff"] as const;
    if (
      agentType === "workshop" &&
      !allowedWorkshopRoles.includes(
        workshopUserRole as (typeof allowedWorkshopRoles)[number],
      )
    ) {
      return new Response(
        JSON.stringify({
          error:
            "workshopUserRole is required for workshop agents — use owner, branch_admin, or staff.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (tenantId) {
      const { data: tenantRow, error: tenantErr } = await supabaseAdmin
        .from("tenants")
        .select("id")
        .eq("id", tenantId)
        .maybeSingle();
      if (tenantErr || !tenantRow?.id) {
        return new Response(
          JSON.stringify({ error: "Invalid tenantId — tenant not found." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // 1. Create auth user
    const { data: newUser, error: userErr } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: name },
      });
    if (userErr) {
      return new Response(JSON.stringify({ error: userErr.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = newUser.user.id;

    // 2. Assign agent role
    const { error: roleErr } = await supabaseAdmin.from("user_roles").insert({
      user_id: userId,
      role: "agent",
    });
    if (roleErr) {
      return new Response(
        JSON.stringify({ error: `Failed to assign role: ${roleErr.message}` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 3. Create agent record using fallback payloads for schema differences
    const agentId = `agent-${Date.now()}`;
    const normalizedPhone = String(phone ?? "").trim();
    const agentBase: Record<string, unknown> = {
      id: agentId,
      user_id: userId,
      name,
      extension: extension || "",
      notes: notes || "",
      email,
      status: "offline",
      role: "agent",
    };
    if (agentType === "workshop") {
      agentBase.bms_owner_uid = workshopOwnerUid;
      agentBase.bms_branch_id = workshopBranchId;
      agentBase.workshop_user_role = workshopUserRole;
    }
    if (tenantId) agentBase.tenant_id = tenantId;

    const minimalWithQueues: Record<string, unknown> = {
      id: agentId,
      user_id: userId,
      name,
      queue_ids: [],
      status: "offline",
    };
    if (tenantId) minimalWithQueues.tenant_id = tenantId;

    const minimalBare: Record<string, unknown> = {
      id: agentId,
      user_id: userId,
      name,
      status: "offline",
    };
    if (tenantId) minimalBare.tenant_id = tenantId;

    const insertCandidates: Record<string, unknown>[] = [
      { ...agentBase, phone_number: normalizedPhone, queue_ids: [] },
      { ...agentBase, phone: normalizedPhone, queue_ids: [] },
      { ...agentBase, phone_number: normalizedPhone },
      { ...agentBase, phone: normalizedPhone },
      minimalWithQueues,
      minimalBare,
    ];

    let agentErr: { message: string } | null = null;
    let insertOk = false;
    for (const payload of insertCandidates) {
      const result = await supabaseAdmin.from("agents").insert(payload);
      if (!result.error) {
        agentErr = null;
        insertOk = true;
        break;
      }
      const msg = result.error.message || "";
      const unknownColumn =
        msg.includes("Could not find the") && msg.includes("column");
      if (unknownColumn) {
        agentErr = result.error;
        continue;
      }
      agentErr = result.error;
    }

    if (!insertOk || agentErr) {
      return new Response(
        JSON.stringify({
          error: `Failed to create agent record: ${agentErr?.message ?? "unknown error"}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Fallback inserts above may omit BMS / workshop columns. Always persist
    // workshop linkage and role after insert so `workshop_user_role` is not lost.
    if (agentType === "workshop") {
      const { error: workshopPatchErr } = await supabaseAdmin
        .from("agents")
        .update({
          bms_owner_uid: workshopOwnerUid,
          bms_branch_id: workshopBranchId,
          workshop_user_role: workshopUserRole,
          extension: String(extension ?? "").trim(),
        })
        .eq("id", agentId);
      if (workshopPatchErr) {
        return new Response(
          JSON.stringify({
            error:
              `Agent was created but saving workshop details failed: ${workshopPatchErr.message}. ` +
              `Apply migrations that add bms_owner_uid, bms_branch_id, and workshop_user_role to public.agents, then update this agent in Supabase.`,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    return new Response(JSON.stringify({ success: true, agentId, userId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
}, ALLOWED_METHODS));
