import { useMemo, useState, useEffect } from 'react';
import type { Agent, Call, Queue, Tenant } from '@/services/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { formatDuration } from '@/utils/formatters';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BarChart, Clock, Phone, TrendingUp, Users, CheckCircle2, XCircle, FileText, Search } from 'lucide-react';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { 
  fetchSalesSuburbWorkshopAgentContactTenant, 
  type SalesSuburbWorkshopContactRow 
} from '@/services/salesWorkspaceApi';
import {
  fetchAgentsPerformance,
  type AgentPerformanceRow,
} from '@/services/agentApis';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

interface AgentPerformanceTabProps {
  agents: Agent[];
  calls: Call[];
  queues: Queue[];
  tenants: Tenant[];
  tenantId?: string | null;
}

export function AgentPerformanceTab({ agents, calls, tenantId }: AgentPerformanceTabProps) {
  const [workshopContacts, setWorkshopContacts] = useState<SalesSuburbWorkshopContactRow[]>([]);
  const [apiPerformance, setApiPerformance] = useState<AgentPerformanceRow[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    fetchSalesSuburbWorkshopAgentContactTenant(tenantId)
      .then(setWorkshopContacts)
      .catch(() => {});
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    fetchAgentsPerformance({ tenantId: tenantId ?? null })
      .then((rows) => {
        if (!cancelled) setApiPerformance(rows);
      })
      .catch(() => {
        if (!cancelled) setApiPerformance([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const apiPerformanceById = useMemo(
    () => new Map(apiPerformance.map((row) => [row.agentId, row] as const)),
    [apiPerformance],
  );

  const allPerformanceData = useMemo(() => {
    // Only include Command Center agents (no BMS link)
    const ccAgents = agents.filter(a => !String(a.bmsOwnerUid ?? '').trim());

    return ccAgents.map((agent) => {
      const apiRow = apiPerformanceById.get(agent.id);

      const agentCalls = calls.filter((c) => c.agentId === agent.id);
      const answeredCallsLocal = agentCalls.filter((c) => c.result === 'answered');
      const localTotalDuration = answeredCallsLocal.reduce(
        (acc, call) => acc + (call.durationSeconds || 0),
        0,
      );
      const localAvgDuration = answeredCallsLocal.length > 0
        ? Math.round(localTotalDuration / answeredCallsLocal.length)
        : 0;
      const localAnswerRate = agentCalls.length > 0
        ? Math.round((answeredCallsLocal.length / agentCalls.length) * 100)
        : 0;

      // Prefer API-aggregated metrics; fall back to live data when missing.
      const totalCalls = apiRow?.totalCalls ?? agentCalls.length;
      const answeredCalls = apiRow?.answeredCalls ?? answeredCallsLocal.length;
      const totalDuration = apiRow?.totalDurationSeconds ?? localTotalDuration;
      const avgDuration = apiRow?.avgDurationSeconds ?? localAvgDuration;
      const answerRate = apiRow?.answerRate ?? localAnswerRate;

      // Call List (Workshops) Performance — prefer API metrics if present.
      const agentWorkshopContacts = workshopContacts.filter(c => c.agent_id === agent.id);
      const listAttempted = apiRow?.listAttempted ?? agentWorkshopContacts.length;
      const listConfirmed = apiRow?.listConfirmed
        ?? agentWorkshopContacts.filter(c => c.call_status === 'confirmed').length;
      const listRejected = apiRow?.listRejected
        ?? agentWorkshopContacts.filter(c => c.call_status === 'rejected').length;

      return {
        ...agent,
        totalCalls,
        answeredCalls,
        totalDuration,
        avgDuration,
        answerRate,
        listAttempted,
        listConfirmed,
        listRejected,
      };
    }).sort((a, b) => {
      if (b.answeredCalls !== a.answeredCalls) return b.answeredCalls - a.answeredCalls;
      return b.listAttempted - a.listAttempted;
    });
  }, [agents, calls, workshopContacts, apiPerformanceById]);

  const filteredPerformanceData = useMemo(() => {
    return allPerformanceData.filter(item => {
      const matchesAgent = selectedAgentId === "all" || item.id === selectedAgentId;
      const matchesSearch = !searchQuery || 
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.extension.includes(searchQuery);
      return matchesAgent && matchesSearch;
    });
  }, [allPerformanceData, selectedAgentId, searchQuery]);

  // Aggregate stats (based on filtered data or all data?)
  // Usually overview stats show the whole team, but user might want them filtered too.
  // We'll show filtered stats if an agent is selected, otherwise team stats.
  const statsData = selectedAgentId !== "all" ? filteredPerformanceData : allPerformanceData;
  const totalAgents = statsData.length;
  const totalAnswered = statsData.reduce((acc, a) => acc + a.answeredCalls, 0);
  const avgTeamHandleTime = totalAnswered > 0 
    ? Math.round(statsData.reduce((acc, a) => acc + a.totalDuration, 0) / totalAnswered)
    : 0;

  return (
    <div className="cc-fade-in space-y-6">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-end sm:items-center justify-between">
        <div className="flex flex-1 items-center gap-4 w-full sm:w-auto">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input 
              placeholder="Search agent name or extension..." 
              className="pl-9 bg-white border-slate-200"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
            <SelectTrigger className="w-[200px] bg-white border-slate-200">
              <SelectValue placeholder="All Agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Agents</SelectItem>
              {allPerformanceData.map(agent => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name} ({agent.extension})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        {selectedAgentId !== "all" && (
          <button 
            onClick={() => setSelectedAgentId("all")}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 underline underline-offset-4"
          >
            Clear Filter
          </button>
        )}
      </div>

      {/* Top Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-border/80 bg-white shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">
                {selectedAgentId !== "all" ? "Filtered Agents" : "Total Agents"}
              </p>
              <p className="text-2xl font-bold text-slate-900">{totalAgents}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-border/80 bg-white shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Phone className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Answered Calls</p>
              <p className="text-2xl font-bold text-slate-900">{totalAnswered}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-border/80 bg-white shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Clock className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Avg Handle Time</p>
              <p className="text-2xl font-bold text-slate-900">{formatDuration(avgTeamHandleTime * 1000)}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-white shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <TrendingUp className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Top Performer</p>
              <p className="text-lg font-bold text-slate-900 truncate">
                {statsData.length > 0 ? statsData[0].name : '-'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/80 bg-white shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-slate-100">
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <BarChart className="h-5 w-5 text-indigo-500" />
            Command Center Agent Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filteredPerformanceData.length === 0 ? (
             <div className="p-8 text-center">
               <EmptyState message={searchQuery || selectedAgentId !== "all" ? "No agents matching your filters" : "No command center agents found"} />
               {(searchQuery || selectedAgentId !== "all") && (
                 <Button 
                   variant="outline" 
                   className="mt-4"
                   onClick={() => {
                     setSearchQuery("");
                     setSelectedAgentId("all");
                   }}
                 >
                   Reset Filters
                 </Button>
               )}
             </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50/50">
                  <TableRow>
                    <TableHead className="w-[200px]" rowSpan={2}>Agent</TableHead>
                    <TableHead rowSpan={2}>Current Status</TableHead>
                    <TableHead className="text-center border-l border-slate-200" colSpan={5}>Call Handling</TableHead>
                    <TableHead className="text-center border-l border-slate-200" colSpan={3}>My Call List</TableHead>
                  </TableRow>
                  <TableRow>
                    <TableHead className="text-right border-l border-slate-200 text-xs">Total</TableHead>
                    <TableHead className="text-right text-xs">Answered</TableHead>
                    <TableHead className="text-right text-xs">Rate</TableHead>
                    <TableHead className="text-right text-xs">Avg Handle</TableHead>
                    <TableHead className="text-right text-xs">Duration</TableHead>
                    <TableHead className="text-right border-l border-slate-200 text-xs">Attempted</TableHead>
                    <TableHead className="text-right text-xs">Confirmed</TableHead>
                    <TableHead className="text-right text-xs">Rejected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPerformanceData.map((agent) => (
                    <TableRow key={agent.id} className="hover:bg-slate-50/50">
                      <TableCell className="font-medium">
                        <div className="flex flex-col">
                          <span>{agent.name}</span>
                          <span className="text-xs text-slate-500 font-mono">Ext {agent.extension}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={agent.status} />
                      </TableCell>
                      
                      {/* Call Handling */}
                      <TableCell className="text-right text-slate-600 border-l border-slate-100">{agent.totalCalls}</TableCell>
                      <TableCell className="text-right font-medium text-slate-900">{agent.answeredCalls}</TableCell>
                      <TableCell className="text-right">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          agent.answerRate >= 90 ? 'bg-emerald-100 text-emerald-700' :
                          agent.answerRate >= 70 ? 'bg-amber-100 text-amber-700' :
                          'bg-rose-100 text-rose-700'
                        }`}>
                          {agent.answerRate}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-slate-600 font-mono text-xs">
                        {formatDuration(agent.avgDuration * 1000)}
                      </TableCell>
                      <TableCell className="text-right text-slate-600 font-mono text-xs">
                        {formatDuration(agent.totalDuration * 1000)}
                      </TableCell>
  
                      {/* My Call List */}
                      <TableCell className="text-right text-slate-600 border-l border-slate-100">
                        <div className="flex items-center justify-end gap-1">
                          <FileText className="h-3 w-3 text-slate-400" />
                          {agent.listAttempted}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-emerald-600 font-medium">
                        <div className="flex items-center justify-end gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          {agent.listConfirmed}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-rose-600 font-medium">
                        <div className="flex items-center justify-end gap-1">
                          <XCircle className="h-3 w-3" />
                          {agent.listRejected}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
