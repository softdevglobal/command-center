import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent, Tenant } from "@/services/types";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fetchAllLeaveRequests,
  fetchLeaveRequest,
  formatLeaveDateRange,
  formatLeaveDurationLabel,
  getLeaveRequestAttachmentSignedUrl,
  reviewLeaveRequest,
  subscribeToAllLeaveRequestChanges,
  type AgentLeaveRequestRow,
} from "@/services/leaveRequestsApi";
import { LeaveRequestPhotoButton } from "@/components/dashboard/LeaveRequestPhotoButton";
import { isSupabaseAuthUserId } from "@/services/attendanceApi";
import { formatDateTimeAu } from "@/utils/australianTime";
import { format } from "date-fns";
import { CalendarOff, Check, X } from "lucide-react";

interface SuperAdminLeaveRequestsBoardProps {
  agents: Agent[];
  tenants: Tenant[];
}

function isCommandCentreAgent(a: Agent): boolean {
  return !String(a.bmsOwnerUid ?? "").trim();
}

function tenantLabel(tenantId: string | null, tenants: Tenant[]): string {
  if (!tenantId) return "—";
  return tenants.find((t) => t.id === tenantId)?.name || tenantId.slice(0, 6);
}

function agentNameFor(userId: string, row: AgentLeaveRequestRow, agents: Agent[]): string {
  const fromRoster = agents.find((a) => a.userId === userId)?.name;
  if (fromRoster) return fromRoster;
  if (row.agent_display_name) return row.agent_display_name;
  return userId.slice(0, 8) + "…";
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

function sortRows(a: AgentLeaveRequestRow, b: AgentLeaveRequestRow): number {
  const rank = (s: string) => (s === "pending" ? 0 : s === "approved" ? 1 : 2);
  const dr = rank(a.status) - rank(b.status);
  if (dr !== 0) return dr;
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

export function SuperAdminLeaveRequestsBoard({ agents, tenants }: SuperAdminLeaveRequestsBoardProps) {
  const [rows, setRows] = useState<AgentLeaveRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRow, setReviewRow] = useState<AgentLeaveRequestRow | null>(null);
  const [reviewDecision, setReviewDecision] = useState<"approved" | "rejected">("approved");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewAttachmentUrl, setReviewAttachmentUrl] = useState<string | null>(null);
  const [reviewAttachmentError, setReviewAttachmentError] = useState<string | null>(null);

  useEffect(() => {
    if (!reviewOpen || !reviewRow?.attachment_storage_path) {
      setReviewAttachmentUrl(null);
      setReviewAttachmentError(null);
      return;
    }
    let cancelled = false;
    setReviewAttachmentUrl(null);
    setReviewAttachmentError(null);
    void getLeaveRequestAttachmentSignedUrl(reviewRow.attachment_storage_path)
      .then((u) => {
        if (!cancelled) setReviewAttachmentUrl(u);
      })
      .catch((e: unknown) => {
        if (!cancelled) setReviewAttachmentError(e instanceof Error ? e.message : "Could not load photo.");
      });
    return () => {
      cancelled = true;
    };
  }, [reviewOpen, reviewRow?.attachment_storage_path]);

  const commandCentreUserIds = useMemo(() => {
    const s = new Set<string>();
    for (const a of agents) {
      if (isCommandCentreAgent(a) && a.userId && isSupabaseAuthUserId(a.userId)) s.add(a.userId);
    }
    return s;
  }, [agents]);

  const visibleRows = useMemo(
    () => rows.filter((r) => commandCentreUserIds.has(r.user_id)).sort(sortRows),
    [rows, commandCentreUserIds],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchAllLeaveRequests();
      setRows(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load leave requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    return subscribeToAllLeaveRequestChanges((row, event) => {
      if (!commandCentreUserIds.has(row.user_id)) return;
      setRows((prev) => {
        if (event === "DELETE") {
          return prev.filter((r) => r.id !== row.id);
        }
        const without = prev.filter((r) => r.id !== row.id);
        return [...without, row];
      });
    });
  }, [commandCentreUserIds]);

  const openReview = (row: AgentLeaveRequestRow, decision: "approved" | "rejected") => {
    setReviewRow(row);
    setReviewDecision(decision);
    setReviewComment("");
    setReviewOpen(true);
    void fetchLeaveRequest(row.id)
      .then((fresh) => {
        setRows((prev) => [...prev.filter((r) => r.id !== fresh.id), fresh]);
        if (fresh.status !== "pending") {
          setReviewOpen(false);
          setReviewRow(null);
          setError("This leave request has already been reviewed.");
          return;
        }
        setReviewRow((current) => (current?.id === row.id ? fresh : current));
      })
      .catch(() => {
        /* Keep the selected row if the detail endpoint is temporarily unavailable. */
      });
  };

  const confirmReview = async () => {
    if (!reviewRow) return;
    setReviewSubmitting(true);
    setError(null);
    try {
      await reviewLeaveRequest({
        requestId: reviewRow.id,
        decision: reviewDecision,
        reviewComment: reviewComment.trim() || null,
      });
      setReviewOpen(false);
      setReviewRow(null);
      void reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not update leave request.");
    } finally {
      setReviewSubmitting(false);
    }
  };

  return (
    <>
      <Card className="cc-fade-in border-border/80 bg-gradient-to-br from-white via-white to-violet-50/20 shadow-sm">
        <CardHeader className="gap-2 border-b border-border/70 pb-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-violet-800">Leave</div>
          <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-950">
            <CalendarOff className="h-5 w-5 shrink-0 text-violet-600" />
            Leave requests
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Approve or reject Command Centre agent leave. Optional comment is shown to the agent.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 p-6">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </div>
          )}
          {loading && visibleRows.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">Loading…</p>
          ) : visibleRows.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">No leave requests from Command Centre agents.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/80 bg-white shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Agent
                    </TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Tenant
                    </TableHead>
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
                      Status
                    </TableHead>
                    <TableHead className="text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium text-sm">
                        {agentNameFor(r.user_id, r, agents)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {tenantLabel(r.tenant_id, tenants)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{formatLeaveDateRange(r)}</TableCell>
                      <TableCell className="text-sm">{formatLeaveDurationLabel(r)}</TableCell>
                      <TableCell className="max-w-[180px] whitespace-normal text-sm text-muted-foreground">
                        {r.reason || "—"}
                      </TableCell>
                      <TableCell>
                        <LeaveRequestPhotoButton storagePath={r.attachment_storage_path} />
                      </TableCell>
                      <TableCell className="space-y-1">
                        {statusBadge(r.status)}
                        {r.review_comment ? (
                          <div className="text-xs text-muted-foreground">&quot;{r.review_comment}&quot;</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.status === "pending" ? (
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="default"
                              className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700"
                              onClick={() => openReview(r, "approved")}
                            >
                              <Check className="h-3.5 w-3.5" />
                              Approve
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1 border-rose-200 text-rose-800 hover:bg-rose-50"
                              onClick={() => openReview(r, "rejected")}
                            >
                              <X className="h-3.5 w-3.5" />
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {r.reviewed_at ? formatDateTimeAu(r.reviewed_at) : "—"}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>{reviewDecision === "approved" ? "Approve leave" : "Reject leave"}</DialogTitle>
            <DialogDescription>
              {reviewRow ? (
                <>
                  {agentNameFor(reviewRow.user_id, reviewRow, agents)} · {formatLeaveDateRange(reviewRow)} ·{" "}
                  {formatLeaveDurationLabel(reviewRow)}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="review-comment">Comment (optional)</Label>
            <Textarea
              id="review-comment"
              placeholder="Note to the agent…"
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              rows={3}
            />
          </div>
          {reviewRow?.attachment_storage_path ? (
            <div className="space-y-2">
              <Label>Attachment</Label>
              {reviewAttachmentError ? (
                <div className="text-sm text-rose-700">{reviewAttachmentError}</div>
              ) : reviewAttachmentUrl ? (
                <div className="overflow-hidden rounded-lg border border-border/60 bg-slate-50 p-2">
                  <img
                    src={reviewAttachmentUrl}
                    alt="Leave attachment"
                    className="mx-auto max-h-52 w-auto object-contain"
                  />
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Loading photo…</div>
              )}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setReviewOpen(false)} disabled={reviewSubmitting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={reviewDecision === "approved" ? "default" : "destructive"}
              disabled={reviewSubmitting}
              onClick={() => void confirmReview()}
            >
              {reviewSubmitting ? "Saving…" : reviewDecision === "approved" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
