import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Loader2, Paperclip, StickyNote } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveBlackCallNote } from "@/services/blackNotesApi";
import { getDIDMappingByDid } from "@/services/didMappingsApi";
import { formatPhone } from "@/utils/formatters";
import type { Call, Permissions, Tenant, UserSession } from "@/services/types";

interface CallNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  call: Call | null;
  resolvedCustomerName: string | null;
  tenants: Tenant[];
  session: UserSession;
  permissions: Permissions;
}

/** Resolve owner/branch/DID for a CDR call so the note can be persisted by the backend. */
async function resolveCallOwnerBranch(
  call: Call,
  tenants: Tenant[],
): Promise<{
  ownerId: string;
  branchId: string;
  branchName: string | null;
  didNumber: string;
}> {
  const tenant = tenants.find((t) => t.id === call.tenantId);
  let ownerId = "";
  let branchId = tenant?.bmsDefaultBranchId?.trim() || "";
  let branchName: string | null = null;
  let didNumber = call.dialedNumber?.trim() || "";

  if (call.dialedNumber) {
    try {
      const mapping = await getDIDMappingByDid(call.dialedNumber);
      if (mapping) {
        ownerId = mapping.ownerId?.trim() || ownerId;
        branchId = mapping.branchId?.trim() || branchId;
        branchName = mapping.branchName?.trim() || branchName;
        didNumber = mapping.did?.trim() || didNumber;
      }
    } catch {
      // Mapping lookup is best-effort (agents may lack access) — fall back below.
    }
  }

  if (!ownerId) ownerId = tenant?.bmsOwnerUid?.trim() || call.tenantId.trim();

  return { ownerId, branchId, branchName, didNumber };
}

export function CallNoteDialog({
  open,
  onOpenChange,
  call,
  resolvedCustomerName,
  tenants,
  session,
  permissions,
}: CallNoteDialogProps) {
  const [note, setNote] = useState("");
  const [attachRecording, setAttachRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canAttachRecording = Boolean(
    permissions.canViewCallRecordings && call?.recordingUrl,
  );

  // Reset form whenever a different call is opened.
  useEffect(() => {
    if (!open) return;
    setNote("");
    setSaving(false);
    setStatusText(null);
    setError(null);
    setSuccess(null);
    setAttachRecording(Boolean(permissions.canViewCallRecordings && call?.recordingUrl));
  }, [open, call?.id, call?.recordingUrl, permissions.canViewCallRecordings]);

  const customerLabel = useMemo(() => {
    if (!call) return "";
    return resolvedCustomerName || call.callerName || formatPhone(call.callerNumber);
  }, [call, resolvedCustomerName]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!call) return;

    const trimmed = note.trim();
    if (!trimmed) {
      setError("Add a note before saving.");
      setSuccess(null);
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      setStatusText("Resolving workshop / branch…");
      const { ownerId, branchId, branchName, didNumber } =
        await resolveCallOwnerBranch(call, tenants);

      if (!ownerId) {
        throw new Error(
          "This call has no owner/branch mapping, so the note cannot be saved.",
        );
      }

      const includeRecording =
        attachRecording && canAttachRecording && call.recordingUrl;

      setStatusText(includeRecording ? "Saving note + recording…" : "Saving note…");
      await saveBlackCallNote({
        callId: call.id,
        agentName: session.displayName?.trim() || "Unknown agent",
        agentUserId: session.userId ?? null,
        callerNumber: call.callerNumber,
        callerName: customerLabel,
        agentNote: trimmed,
        didNumber,
        ownerId,
        branchId,
        branchName,
        queueId: call.queueId,
        queueName: call.queueName,
        tenantId: call.tenantId,
        recordingUrl: includeRecording ? call.recordingUrl : null,
        recordingCallId: includeRecording ? call.id : null,
      });

      setSuccess(
        includeRecording
          ? "Note and recording saved to agent activities."
          : "Note saved to agent activities.",
      );
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save call note.");
    } finally {
      setSaving(false);
      setStatusText(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (saving ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StickyNote className="h-4 w-4 text-emerald-600" />
            Add call note
          </DialogTitle>
          <DialogDescription>
            {call
              ? `${customerLabel} • ${formatPhone(call.callerNumber)}`
              : "Save an agent note for this call."}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <Textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
              setSuccess(null);
            }}
            placeholder="Type the agent note for this caller…"
            className="min-h-[150px] resize-y bg-white"
            disabled={saving}
            autoFocus
          />

          {canAttachRecording ? (
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 accent-emerald-600"
                checked={attachRecording}
                onChange={(e) => setAttachRecording(e.target.checked)}
                disabled={saving}
              />
              <Paperclip className="h-3.5 w-3.5 text-slate-500" />
              Include call recording (backend fetches from CDR)
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">
              {call?.recordingUrl
                ? "Recording attachment is restricted for your role."
                : "No recording is available for this call."}
            </p>
          )}

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          {success ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {success}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Close
            </Button>
            <Button
              type="submit"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <StickyNote className="h-4 w-4" />
              )}
              {saving ? statusText || "Saving…" : "Save note"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
