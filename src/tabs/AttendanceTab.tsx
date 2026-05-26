import type { Agent, Permissions, Tenant, UserSession } from "@/services/types";
import { AgentAttendanceCard } from "@/components/dashboard/AgentAttendanceCard";
import { AgentLeaveRequestsCard } from "@/components/dashboard/AgentLeaveRequestsCard";
import { SuperAdminAttendanceBoard } from "@/components/dashboard/SuperAdminAttendanceBoard";
import { SuperAdminLeaveRequestsBoard } from "@/components/dashboard/SuperAdminLeaveRequestsBoard";
import { AgentShiftScheduleBoard } from "@/components/dashboard/AgentShiftScheduleBoard";
import { AgentShiftScheduleView } from "@/components/dashboard/AgentShiftScheduleView";

interface AttendanceTabProps {
  session: UserSession;
  permissions: Permissions;
  agents: Agent[];
  tenants: Tenant[];
  now: number;
  /** Which area of Attendance to show. */
  section: "shifts" | "leave" | "shift-schedule";
}

export function AttendanceTab({
  session,
  permissions,
  agents,
  tenants,
  now,
  section,
}: AttendanceTabProps) {
  if (!permissions.canViewAttendanceTab) {
    return null;
  }

  if (session.role === "super-admin") {
    if (section === "shifts") {
      return (
        <div className="cc-fade-in mx-auto max-w-7xl space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Time tracking</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Command center agents only. Pick any day (up to today) to review attendance.
            </p>
          </div>
          <SuperAdminAttendanceBoard agents={agents} tenants={tenants} now={now} />
        </div>
      );
    }
    if (section === "shift-schedule") {
      return (
        <div className="cc-fade-in mx-auto max-w-7xl space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Shift schedule</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Define the weekly working hours for each agent.
            </p>
          </div>
          <AgentShiftScheduleBoard agents={agents} />
        </div>
      );
    }
    return (
      <div className="cc-fade-in mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Leave requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review and approve or reject agent leave. Optional comments are visible to agents.
          </p>
        </div>
        <SuperAdminLeaveRequestsBoard agents={agents} tenants={tenants} />
      </div>
    );
  }

  if (session.role === "agent" && permissions.canViewShiftPanel) {
    if (section === "shifts") {
      return (
        <div className="cc-fade-in mx-auto max-w-6xl space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Time tracking</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Clock in, take breaks, and clock out. Your time is saved to the Command Centre.
            </p>
          </div>
          <AgentAttendanceCard session={session} now={now} />
        </div>
      );
    }
    if (section === "shift-schedule") {
      return (
        <div className="cc-fade-in mx-auto max-w-6xl space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Shift schedule</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your weekly working hours as defined by the admin.
            </p>
          </div>
          <AgentShiftScheduleView session={session} agents={agents} />
        </div>
      );
    }
    return (
      <div className="cc-fade-in mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Leave requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Apply for full-day or half-day leave. A super-admin will approve or reject your request.
          </p>
        </div>
        <AgentLeaveRequestsCard session={session} />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/80 bg-white p-8 text-center text-sm text-muted-foreground shadow-sm">
      Attendance is not available for your role.
    </div>
  );
}
