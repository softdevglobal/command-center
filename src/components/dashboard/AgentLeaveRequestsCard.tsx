import { useCallback, useEffect, useMemo, useState } from "react";
import type { UserSession } from "@/services/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LeaveRequestPhotoButton } from "@/components/dashboard/LeaveRequestPhotoButton";
import {
  deleteMyPendingLeaveRequest,
  fetchMyLeaveRequests,
  formatLeaveDateRange,
  formatLeaveDurationLabel,
  insertLeaveRequest,
  LEAVE_ATTACHMENT_MAX_BYTES,
  subscribeToMyLeaveRequests,
  type AgentLeaveRequestRow,
  type LeaveDurationType,
  type LeaveHalfDayPart,
} from "@/services/leaveRequestsApi";
import { getAustralianDateKey } from "@/utils/australianTime";
import { format, startOfDay } from "date-fns";
import { CalendarOff, Trash2, X } from "lucide-react";

interface AgentLeaveRequestsCardProps {
  session: UserSession;
}

function statusBadge(status: string) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
          Pending
        </Badge>
      );
    case "approved":
      return (
        <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-900">
          Approved
        </Badge>
      );
    case "rejected":
      return (
        <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-900">
          Rejected
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function sortRequests(a: AgentLeaveRequestRow, b: AgentLeaveRequestRow): number {
  const rank = (s: string) => (s === "pending" ? 0 : s === "approved" ? 1 : 2);
  const dr = rank(a.status) - rank(b.status);
  if (dr !== 0) return dr;
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

export function AgentLeaveRequestsCard({ session }: AgentLeaveRequestsCardProps) {
  const [rows, setRows] = useState<AgentLeaveRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const supabaseUserId = session.userId || null;

  const todayKey = useMemo(() => getAustralianDateKey(Date.now()), []);

  const [startDate, setStartDate] = useState(todayKey);
  const [endDate, setEndDate] = useState(todayKey);
  const [durationType, setDurationType] = useState<LeaveDurationType>("full_day");
  const [halfDayPart, setHalfDayPart] = useState<LeaveHalfDayPart>("am");
  const [reason, setReason] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const attachmentPreviewUrl = useMemo(
    () => (attachmentFile ? URL.createObjectURL(attachmentFile) : null),
    [attachmentFile],
  );

  useEffect(() => {
    return () => {
      if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
    };
  }, [attachmentPreviewUrl]);

  const reload = useCallback(async () => {
    if (supabaseUserId === null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await fetchMyLeaveRequests(supabaseUserId);
      setRows([...list].sort(sortRequests));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load leave requests.");
    } finally {
      setLoading(false);
    }
  }, [supabaseUserId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!supabaseUserId) return;
    return subscribeToMyLeaveRequests(supabaseUserId, (row, event) => {
      setRows((prev) => {
        if (event === "DELETE") {
          return prev.filter((r) => r.id !== row.id);
        }
        const without = prev.filter((r) => r.id !== row.id);
        return [...without, row].sort(sortRequests);
      });
    });
  }, [supabaseUserId]);

  if (supabaseUserId === undefined) {
    return (
      <Card className="border-border/80 bg-white/80 shadow-sm">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Loading leave requests…
        </CardContent>
      </Card>
    );
  }

  if (supabaseUserId === null) {
    return null;
  }

  const uid = supabaseUserId;

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await insertLeaveRequest({
        userId: uid,
        tenantId: session.tenantId,
        displayName: session.displayName,
        startDate,
        endDate,
        durationType,
        halfDayPart: durationType === "half_day" ? halfDayPart : null,
        reason: reason.trim() || null,
        attachmentFile: attachmentFile?.size ? attachmentFile : null,
      });
      setReason("");
      setAttachmentFile(null);
      void reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not submit leave request.");
    } finally {
      setSubmitting(false);
    }
  };

  const onWithdraw = async (id: string) => {
    setError(null);
    try {
      await deleteMyPendingLeaveRequest(uid, id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not withdraw request.");
    }
  };

  return (
    <Card className="cc-fade-in border-border/80 bg-gradient-to-br from-white via-white to-sky-50/25 shadow-sm">
      <CardHeader className="gap-2 border-b border-border/70 pb-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-sky-800">Leave</div>
        <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-950">
          <CalendarOff className="h-5 w-5 shrink-0 text-sky-600" />
          Apply for leave
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Submit full-day or half-day leave for one or more days. A super-admin will approve or reject your request.
        </p>
      </CardHeader>
      <CardContent className="space-y-6 p-6">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="leave-start">Start date</Label>
            <input
              id="leave-start"
              type="date"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="leave-end">End date</Label>
            <input
              id="leave-end"
              type="date"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Duration</Label>
            <Select value={durationType} onValueChange={(v) => setDurationType(v as LeaveDurationType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full_day">Full day (each day in range)</SelectItem>
                <SelectItem value="half_day">Half day (each day in range)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {durationType === "half_day" ? (
            <div className="space-y-2">
              <Label>Half day</Label>
              <Select value={halfDayPart} onValueChange={(v) => setHalfDayPart(v as LeaveHalfDayPart)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="am">Morning (AM)</SelectItem>
                  <SelectItem value="pm">Afternoon (PM)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="hidden sm:block" aria-hidden />
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="leave-reason">Reason (optional)</Label>
          <Textarea
            id="leave-reason"
            placeholder="e.g. Annual leave, appointment…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="leave-photo">Photo (optional)</Label>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <input
              id="leave-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif"
              className="text-sm text-slate-700 file:mr-3 file:rounded-md file:border file:border-input file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setAttachmentFile(f);
                e.target.value = "";
              }}
            />
            {attachmentFile ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 gap-1 text-muted-foreground"
                onClick={() => setAttachmentFile(null)}
              >
                <X className="h-4 w-4" />
                Remove
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            JPEG, PNG, WebP, GIF, or HEIC. Max {Math.round(LEAVE_ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB.
          </p>
          {attachmentPreviewUrl ? (
            <div className="overflow-hidden rounded-lg border border-border/70 bg-muted/30 p-2">
              <img
                src={attachmentPreviewUrl}
                alt=""
                className="mx-auto max-h-40 w-auto object-contain"
              />
            </div>
          ) : null}
        </div>

        <Button type="button" className="w-full sm:w-auto" disabled={submitting} onClick={() => void onSubmit()}>
          {submitting ? "Submitting…" : "Submit leave request"}
        </Button>

        <div className="rounded-xl border border-border/80 bg-white shadow-sm">
          <div className="border-b border-border/60 bg-slate-50/80 px-4 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Your requests
            </div>
          </div>
          {loading && rows.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">No leave requests yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Dates
                    </TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Type
                    </TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Reason
                    </TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Photo
                    </TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Decision
                    </TableHead>
                    <TableHead className="w-24 text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-sm">{formatLeaveDateRange(r)}</TableCell>
                      <TableCell className="text-sm">{formatLeaveDurationLabel(r)}</TableCell>
                      <TableCell className="max-w-[200px] whitespace-normal text-sm text-muted-foreground">
                        {r.reason || "—"}
                      </TableCell>
                      <TableCell>
                        <LeaveRequestPhotoButton storagePath={r.attachment_storage_path} label="View" />
                      </TableCell>
                      <TableCell className="space-y-1">
                        {statusBadge(r.status)}
                        {r.review_comment ? (
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium text-slate-700">Comment: </span>
                            {r.review_comment}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.status === "pending" ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                            onClick={() => void onWithdraw(r.id)}
                            aria-label="Withdraw pending request"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
