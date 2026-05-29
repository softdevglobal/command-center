import { useState, useEffect } from "react";
import { Agent, AgentShiftSchedule, Queue, UserSession } from "@/services/types";
import { fetchMyShiftSchedule } from "@/services/attendanceApi";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, Calendar } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface AgentShiftScheduleViewProps {
  session: UserSession;
  agents: Agent[];
  queues: Queue[];
}

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

type ShiftDay = (typeof DAYS)[number];
type ShiftDayQueueKey = `${ShiftDay}QueueId`;

const QUEUE_ID_BY_DAY = {
  monday: "mondayQueueId",
  tuesday: "tuesdayQueueId",
  wednesday: "wednesdayQueueId",
  thursday: "thursdayQueueId",
  friday: "fridayQueueId",
  saturday: "saturdayQueueId",
  sunday: "sundayQueueId",
} satisfies Record<ShiftDay, ShiftDayQueueKey>;

export function AgentShiftScheduleView({ session, agents, queues }: AgentShiftScheduleViewProps) {
  const [loading, setLoading] = useState(true);
  const [schedule, setSchedule] = useState<AgentShiftSchedule | null>(null);
  const queueById = new Map(queues.map((queue) => [queue.id, queue]));

  useEffect(() => {
    async function load() {
      try {
        const matchingAgentIds = agents
          .filter((agent) => agent.userId === session.userId)
          .map((agent) => agent.id);

        const data = await fetchMyShiftSchedule({
          userId: session.userId,
          candidateIds: matchingAgentIds,
        });
        setSchedule(data);
      } catch (err) {
        console.error(err);
        toast({
          title: "Error",
          description: "Failed to load your shift schedule",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [session.userId, agents]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!schedule) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">
          No shift schedule defined by admin yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {DAYS.map((day) => {
        const value = schedule[day];
        const isOff = !value || value.toLowerCase() === "off";
        const queueId = schedule[QUEUE_ID_BY_DAY[day]];
        const queue = queueId ? queueById.get(queueId) : null;
        
        return (
          <Card key={day} className={isOff ? "opacity-60" : "border-primary/20 bg-primary/5"}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium capitalize flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                {day}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isOff ? "OFF" : value}
              </div>
              <CardDescription>
                {isOff
                  ? "Relax and recharge"
                  : queue
                    ? `Working ${queue.icon} ${queue.name}`
                    : "Working hours"}
              </CardDescription>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
