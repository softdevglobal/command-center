import { useMemo, useState, useEffect } from "react";
import { Agent, AgentShiftSchedule, Queue } from "@/services/types";
import { fetchAgentShiftSchedules, upsertAgentShiftSchedule } from "@/services/attendanceApi";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Search, Clock, Moon } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AgentShiftScheduleBoardProps {
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

const DEFAULT_SHIFT_START = "09:00";
const DEFAULT_SHIFT_END = "18:00";
const NO_QUEUE_VALUE = "__no_queue__";

function blankSchedule(agentId: string): AgentShiftSchedule {
  return {
    id: "",
    agentId,
    dayQueueIds: {},
    monday: null,
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    saturday: null,
    sunday: null,
  };
}

function parseTimeToInput(raw: string | null | undefined, fallback: string): string {
  const value = raw?.trim();
  if (!value) return fallback;

  const twentyFourHour = value.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHour) {
    const hour = Number(twentyFourHour[1]);
    const minute = Number(twentyFourHour[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  const twelveHour = value.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (twelveHour) {
    const baseHour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2] ?? "0");
    if (baseHour >= 1 && baseHour <= 12 && minute >= 0 && minute <= 59) {
      const period = twelveHour[3].toUpperCase();
      const hour = period === "PM" ? (baseHour % 12) + 12 : baseHour % 12;
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  return fallback;
}

function formatTimeForApi(input: string): string {
  const [hourRaw, minuteRaw] = input.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return input;

  const period = hour >= 12 ? "PM" : "AM";
  const twelveHour = hour % 12 || 12;
  return `${twelveHour}:${String(minute).padStart(2, "0")} ${period}`;
}

function parseShift(val: string | null) {
  if (!val || val.toUpperCase() === "OFF")
    return { isOff: true, start: DEFAULT_SHIFT_START, end: DEFAULT_SHIFT_END };
  const parts = val.split(/\s+-\s+/);
  if (parts.length === 2) {
    return {
      isOff: false,
      start: parseTimeToInput(parts[0], DEFAULT_SHIFT_START),
      end: parseTimeToInput(parts[1], DEFAULT_SHIFT_END),
    };
  }
  return { isOff: true, start: DEFAULT_SHIFT_START, end: DEFAULT_SHIFT_END };
}

function formatShift(isOff: boolean, start: string, end: string): string | null {
  return isOff ? null : `${formatTimeForApi(start)} - ${formatTimeForApi(end)}`;
}

function ShiftCell({
  value,
  queueId,
  queueOptions,
  onShiftChange,
  onQueueChange,
}: {
  value: string | null;
  queueId: string | null;
  queueOptions: Queue[];
  onShiftChange: (newVal: string | null) => void;
  onQueueChange: (queueId: string | null) => void;
}) {
  const { isOff, start, end } = parseShift(value);
  const selectedQueue = queueOptions.find((queue) => queue.id === queueId);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`h-auto min-h-8 w-full justify-start px-2 py-1 font-normal ${
            isOff ? "text-muted-foreground bg-slate-50" : "text-slate-950 font-medium border-emerald-100 bg-emerald-50/30"
          }`}
        >
          {isOff ? (
            <span className="flex items-center gap-1.5 opacity-60">
              <Moon className="h-3 w-3" />
              OFF
            </span>
          ) : (
            <span className="flex min-w-0 flex-col items-start gap-0.5">
              <span className="flex items-center gap-1.5 truncate">
                <Clock className="h-3 w-3 text-emerald-600" />
                {formatTimeForApi(start)}–{formatTimeForApi(end)}
              </span>
              <span className="max-w-full truncate text-[10px] font-semibold text-sky-700">
                {selectedQueue ? selectedQueue.name : "No queue"}
              </span>
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4 shadow-xl border-slate-200" align="start">
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b pb-3 border-slate-100">
            <Label htmlFor="off-toggle" className="font-semibold text-slate-900">Mark as Day Off</Label>
            <Switch
              id="off-toggle"
              checked={isOff}
              onCheckedChange={(checked) => {
                onShiftChange(formatShift(checked, start, end));
                if (checked) onQueueChange(null);
              }}
            />
          </div>

          {!isOff && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Start Time</Label>
                  <Input
                    type="time"
                    value={start}
                    onChange={(e) => onShiftChange(formatShift(false, e.target.value, end))}
                    className="h-9 focus-visible:ring-emerald-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">End Time</Label>
                  <Input
                    type="time"
                    value={end}
                    onChange={(e) => onShiftChange(formatShift(false, start, e.target.value))}
                    className="h-9 focus-visible:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Queue</Label>
                <Select
                  value={queueId || NO_QUEUE_VALUE}
                  onValueChange={(nextQueueId) =>
                    onQueueChange(nextQueueId === NO_QUEUE_VALUE ? null : nextQueueId)
                  }
                >
                  <SelectTrigger className="h-9 focus:ring-emerald-500">
                    <SelectValue placeholder="Select queue" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_QUEUE_VALUE}>No queue assigned</SelectItem>
                    {queueOptions.map((queue) => (
                      <SelectItem key={queue.id} value={queue.id}>
                        {queue.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          
          <div className="pt-2">
            <p className="text-[10px] text-muted-foreground italic">
              Changes are saved locally. Click the save icon in the row to sync.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AgentShiftScheduleBoard({ agents, queues }: AgentShiftScheduleBoardProps) {
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<Record<string, AgentShiftSchedule>>({});
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const queuesById = useMemo(() => new Map(queues.map((queue) => [queue.id, queue])), [queues]);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchAgentShiftSchedules();
        const map: Record<string, AgentShiftSchedule> = {};
        data.forEach((s) => {
          map[s.agentId] = s;
        });
        setSchedules(map);
      } catch (err) {
        console.error(err);
        toast({
          title: "Error",
          description: "Failed to load shift schedules",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleShiftUpdate = (agentId: string, day: (typeof DAYS)[number], value: string | null) => {
    setSchedules((prev) => ({
      ...prev,
      [agentId]: {
        ...(prev[agentId] || blankSchedule(agentId)),
        [day]: value,
      } as AgentShiftSchedule,
    }));
  };

  const handleQueueUpdate = (agentId: string, day: (typeof DAYS)[number], queueId: string | null) => {
    setSchedules((prev) => {
      const current = prev[agentId] || blankSchedule(agentId);
      return {
        ...prev,
        [agentId]: {
          ...current,
          dayQueueIds: {
            ...(current.dayQueueIds ?? {}),
            [day]: queueId,
          },
        },
      };
    });
  };

  const handleSave = async (agentId: string) => {
    setSavingId(agentId);
    try {
      const saved = await upsertAgentShiftSchedule(schedules[agentId] ?? blankSchedule(agentId));
      setSchedules((prev) => ({ ...prev, [agentId]: saved }));
      toast({
        title: "Success",
        description: "Shift schedule saved",
      });
    } catch (err) {
      console.error(err);
      toast({
        title: "Error",
        description: "Failed to save shift schedule",
        variant: "destructive",
      });
    } finally {
      setSavingId(null);
    }
  };

  const filteredAgents = agents.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  const queueOptionsForAgent = (agent: Agent, selectedQueueId?: string | null) => {
    const tenantQueues = queues.filter((queue) => queue.tenantId === agent.tenantId);
    const options = tenantQueues.length > 0 ? tenantQueues : queues;
    const selectedQueue = selectedQueueId ? queuesById.get(selectedQueueId) : undefined;

    if (selectedQueue && !options.some((queue) => queue.id === selectedQueue.id)) {
      return [...options, selectedQueue];
    }

    return options;
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm bg-white">
        <Table>
          <TableHeader className="bg-slate-50/50">
            <TableRow>
              <TableHead className="w-[180px] text-slate-600 font-semibold">Agent</TableHead>
              {DAYS.map((day) => (
                <TableHead key={day} className="capitalize min-w-[130px] text-slate-600 font-semibold">
                  {day}
                </TableHead>
              ))}
              <TableHead className="sticky right-0 z-20 w-[80px] bg-slate-50/95 text-right font-semibold text-slate-600 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.35)]">
                Sync
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAgents.map((agent) => (
              <TableRow key={agent.id} className="hover:bg-slate-50/50">
                <TableCell className="font-semibold text-slate-900">{agent.name}</TableCell>
                {DAYS.map((day) => (
                  <TableCell key={day}>
                    <ShiftCell
                      value={schedules[agent.id]?.[day] ?? null}
                      queueId={schedules[agent.id]?.dayQueueIds?.[day] ?? null}
                      queueOptions={queueOptionsForAgent(agent, schedules[agent.id]?.dayQueueIds?.[day])}
                      onShiftChange={(newVal) => handleShiftUpdate(agent.id, day, newVal)}
                      onQueueChange={(queueId) => handleQueueUpdate(agent.id, day, queueId)}
                    />
                  </TableCell>
                ))}
                <TableCell className="sticky right-0 z-10 bg-white text-right shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.28)]">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleSave(agent.id)}
                    disabled={savingId === agent.id}
                    className="h-8 w-8 p-0 hover:bg-emerald-50 hover:text-emerald-600 rounded-full"
                  >
                    {savingId === agent.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
