import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useDashboard } from '@/context/DashboardDataContext';
import { 
  fetchInternalConversations, 
  fetchInternalMessages, 
  sendInternalMessage, 
  getOrCreateInternalConversation,
  subscribeToInternalMessages,
  subscribeToAllInternalConversations,
  fetchAllInternalConversations,
  fetchInternalChatAgents,
  isCommandCentreAgent,
  resolveSuperAdminMessagingAgentId,
  InternalChatConversation,
  InternalChatMessage
} from '@/services/chatApi';
import { linkAgentToUser, createSuperAdminAgent } from '@/services/dashboardApi';
import { UserSession, Agent, Permissions } from '@/services/types';
import { 
  MessageSquare, 
  Send, 
  User, 
  Plus,
  Search,
  Clock,
  Clock3,
  Check,
  CheckCheck,
  ArrowLeft,
  ShieldAlert,
  Eye,
} from 'lucide-react';
import { 
  playNewMessageChime, 
  isChatSoundMuted 
} from '@/lib/chatNotificationSounds';
import { formatDistanceToNow } from 'date-fns';

interface InternalChatTabProps {
  session: UserSession;
  permissions: Permissions;
}

type SuperAdminListFilter = 'all' | 'mine';

function resolveConversationDisplay(
  conv: InternalChatConversation,
  myAgentId: string | null,
  isSuperAdmin: boolean,
): { title: string; subtitle: string; isOversight: boolean } {
  if (!isSuperAdmin || (!conv.agentA && !conv.agentB)) {
    return {
      title: conv.otherParticipant?.name ?? 'Internal conversation',
      subtitle: conv.otherParticipant?.status ?? 'offline',
      isOversight: false,
    };
  }

  const agentA = conv.agentA!;
  const agentB = conv.agentB!;

  if (
    myAgentId &&
    (conv.participant_a === myAgentId || conv.participant_b === myAgentId)
  ) {
    const other = conv.participant_a === myAgentId ? agentB : agentA;
    return {
      title: other.name,
      subtitle: other.status ?? 'offline',
      isOversight: false,
    };
  }

  return {
    title: `${agentA.name} ↔ ${agentB.name}`,
    subtitle: 'Agent conversation',
    isOversight: true,
  };
}

function hydrateConversationParticipants(
  conv: InternalChatConversation,
  agentsById: Map<string, Agent>,
  myAgentId: string | null,
): InternalChatConversation {
  const rosterAgentA = agentsById.get(conv.participant_a);
  const rosterAgentB = agentsById.get(conv.participant_b);
  const agentA =
    !conv.agentA || conv.agentA.name === 'Unknown'
      ? rosterAgentA ?? conv.agentA
      : conv.agentA;
  const agentB =
    !conv.agentB || conv.agentB.name === 'Unknown'
      ? rosterAgentB ?? conv.agentB
      : conv.agentB;
  const rosterOther = conv.otherParticipant?.id
    ? agentsById.get(conv.otherParticipant.id)
    : undefined;
  const otherParticipant =
    (!conv.otherParticipant || conv.otherParticipant.name === 'Unknown'
      ? rosterOther
      : undefined) ??
    (myAgentId && conv.participant_a === myAgentId ? agentB : undefined) ??
    (myAgentId && conv.participant_b === myAgentId ? agentA : undefined) ??
    conv.otherParticipant;

  return {
    ...conv,
    agentA,
    agentB,
    otherParticipant,
  };
}

function findCurrentAgent(agents: Agent[], session: UserSession): Agent | undefined {
  const byUserId = agents.find((a) => a.userId === session.userId);
  if (byUserId) return byUserId;

  const email = session.authEmail?.trim().toLowerCase();
  if (!email) return undefined;
  return agents.find((a) => (a.email ?? '').trim().toLowerCase() === email);
}

export function InternalChatTab({ session, permissions }: InternalChatTabProps) {
  const { agents, tenants } = useDashboard();
  const queryClient = useQueryClient();
  const [conversations, setConversations] = useState<InternalChatConversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<InternalChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNewChat, setShowNewChat] = useState(false);
  const [agentSearch, setAgentSearch] = useState('');
  const [listSearch, setListSearch] = useState('');
  const [composeError, setComposeError] = useState<string | null>(null);
  const [superAdminListFilter, setSuperAdminListFilter] =
    useState<SuperAdminListFilter>('all');
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [linkingAgentId, setLinkingAgentId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [creatingSuperAgent, setCreatingSuperAgent] = useState(false);
  const [internalRoster, setInternalRoster] = useState<Agent[]>([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const isSuperAdmin = session.role === 'super-admin';

  useEffect(() => {
    let cancelled = false;
    const hasDashboardRoster = agents.length > 0;
    setRosterLoading(!hasDashboardRoster);
    setRosterError(null);

    fetchInternalChatAgents({ preferAgentsApi: isSuperAdmin })
      .then((rows) => {
        if (!cancelled) setInternalRoster(rows);
      })
      .catch((error) => {
        if (!cancelled) {
          if (!hasDashboardRoster) {
            setRosterError(
              error instanceof Error ? error.message : 'Could not load agent roster.',
            );
          }
          setInternalRoster([]);
        }
      })
      .finally(() => {
        if (!cancelled) setRosterLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agents.length, isSuperAdmin]);

  const chatAgents = useMemo(() => {
    const byId = new Map<string, Agent>();
    for (const agent of [...internalRoster, ...agents]) {
      byId.set(agent.id, agent);
    }
    return [...byId.values()];
  }, [agents, internalRoster]);

  const agentsById = useMemo(
    () => new Map(chatAgents.map((agent) => [agent.id, agent] as const)),
    [chatAgents],
  );

  const currentAgent = useMemo(() => 
    findCurrentAgent(chatAgents, session),
    [chatAgents, session]
  );

  const superAdminSenderId = useMemo(
    () =>
      isSuperAdmin
        ? resolveSuperAdminMessagingAgentId(chatAgents, session.userId)
        : null,
    [isSuperAdmin, chatAgents, session.userId],
  );

  const messagingAgentId = currentAgent?.id ?? superAdminSenderId ?? null;

  const commandCentreAgents = useMemo(
    () => chatAgents.filter(isCommandCentreAgent),
    [chatAgents],
  );

  const messageableAgents = useMemo(
    () => commandCentreAgents.filter((a) => a.id !== messagingAgentId),
    [commandCentreAgents, messagingAgentId],
  );

  /** CC agents that have no auth user linked yet — candidates for super-admin to claim. */
  const linkableAgents = useMemo(
    () => commandCentreAgents.filter((a) => !a.userId),
    [commandCentreAgents],
  );

  const handleLinkAgent = useCallback(
    async (agentId: string) => {
      if (!session.userId) return;
      setLinkingAgentId(agentId);
      setLinkError(null);
      try {
        await linkAgentToUser(agentId, session.userId);
        await queryClient.invalidateQueries({ queryKey: ['agents'] });
        setShowLinkPicker(false);
      } catch (error) {
        setLinkError(
          error instanceof Error
            ? error.message
            : 'Could not link agent. Check RLS permissions.',
        );
      } finally {
        setLinkingAgentId(null);
      }
    },
    [session.userId, queryClient],
  );

  const handleCreateSuperAdminAgent = useCallback(async () => {
    if (!session.userId || creatingSuperAgent) return;
    setLinkError(null);
    const tenantId = session.tenantId ?? tenants[0]?.id ?? null;
    if (!tenantId) {
      setLinkError('No tenant available. Create a tenant first.');
      return;
    }
    setCreatingSuperAgent(true);
    try {
      await createSuperAdminAgent({
        userId: session.userId,
        name: session.displayName || 'Super Admin',
        tenantId,
        email: session.authEmail ?? null,
      });
      await queryClient.invalidateQueries({ queryKey: ['agents'] });
      setShowLinkPicker(false);
    } catch (error) {
      setLinkError(
        error instanceof Error
          ? error.message
          : 'Could not create super admin agent.',
      );
    } finally {
      setCreatingSuperAgent(false);
    }
  }, [
    session.userId,
    session.displayName,
    session.tenantId,
    session.authEmail,
    tenants,
    queryClient,
    creatingSuperAgent,
  ]);

  // Load conversations
  const loadConversations = useCallback(async () => {
    if (rosterLoading && !isSuperAdmin) return;
    try {
      const data = isSuperAdmin 
        ? await fetchAllInternalConversations() 
        : await fetchInternalConversations(messagingAgentId);
      setConversations(
        data.map((conv) =>
          hydrateConversationParticipants(conv, agentsById, messagingAgentId),
        ),
      );
    } catch (error) {
      console.error('Failed to load conversations', error);
    } finally {
      setLoading(false);
    }
  }, [agentsById, messagingAgentId, isSuperAdmin, rosterLoading]);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const { markInternalMessagesAsRead, markInternalConversationAllRead } =
        await import('@/services/chatApi');
      const data = await fetchInternalMessages(conversationId);
      setMessages(data);

      if (messagingAgentId) {
        await markInternalMessagesAsRead(conversationId, messagingAgentId);
        setConversations(prev => prev.map(c =>
          c.id === conversationId ? { ...c, unreadCount: 0 } : c
        ));
        window.dispatchEvent(new CustomEvent('internal-chat-read'));
      } else if (isSuperAdmin) {
        await markInternalConversationAllRead(conversationId);
        setConversations(prev => prev.map(c =>
          c.id === conversationId ? { ...c, unreadCount: 0 } : c
        ));
        window.dispatchEvent(new CustomEvent('internal-chat-read'));
      }
    } catch (error) {
      console.error('Failed to load messages', error);
    }
  }, [messagingAgentId, isSuperAdmin]);

  useEffect(() => {
    loadConversations();
    const unsub = subscribeToAllInternalConversations(() => {
      loadConversations();
    });
    return () => { unsub(); };
  }, [loadConversations]);

  // Load messages for selected conversation
  useEffect(() => {
    if (!selectedConvId) {
      setMessages([]);
      return;
    }

    void loadMessages(selectedConvId);
    const unsub = subscribeToInternalMessages(selectedConvId, (msg) => {
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        
        // Play sound if not from self
        if (msg.sender_id !== messagingAgentId && !isChatSoundMuted()) {
          void playNewMessageChime();
        }
        
        return [...prev, msg];
      });
      loadConversations(); // Refresh last message in list
    });

    return () => { unsub(); };
  }, [selectedConvId, loadMessages, loadConversations, messagingAgentId]);

  const selectedConv = useMemo(() => 
    conversations.find(c => c.id === selectedConvId), 
    [conversations, selectedConvId]
  );

  const selectedConvDisplay = useMemo(
    () =>
      selectedConv
        ? resolveConversationDisplay(
            selectedConv,
            messagingAgentId,
            isSuperAdmin,
          )
        : null,
    [selectedConv, messagingAgentId, isSuperAdmin],
  );

  const canSendInSelectedConv = useMemo(() => {
    if (!selectedConv) return false;
    if (!isSuperAdmin) return true;
    if (!messagingAgentId) return false;
    return (
      selectedConv.participant_a === messagingAgentId ||
      selectedConv.participant_b === messagingAgentId
    );
  }, [selectedConv, isSuperAdmin, messagingAgentId]);

  const filteredConversations = useMemo(() => {
    let list = conversations;
    if (isSuperAdmin && superAdminListFilter === 'mine' && messagingAgentId) {
      list = list.filter(
        (c) =>
          c.participant_a === messagingAgentId ||
          c.participant_b === messagingAgentId,
      );
    }
    const q = listSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((conv) => {
      const { title } = resolveConversationDisplay(
        conv,
        messagingAgentId,
        isSuperAdmin,
      );
      return (
        title.toLowerCase().includes(q) ||
        (conv.last_message?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [
    conversations,
    listSearch,
    isSuperAdmin,
    superAdminListFilter,
    messagingAgentId,
  ]);

  const handleStartChat = useCallback(async (targetAgentId: string) => {
    if (isSuperAdmin && !messagingAgentId) {
      setComposeError(
        'Link a command centre agent profile to your super admin account (Agents tab) to send messages.',
      );
      return;
    }
    setComposeError(null);
    try {
      const convId = await getOrCreateInternalConversation(
        messagingAgentId,
        targetAgentId,
      );
      setSelectedConvId(convId);
      setShowNewChat(false);
      await loadConversations();
    } catch (error) {
      console.error('Failed to start chat', error);
      setComposeError('Could not start conversation. Try again.');
    }
  }, [isSuperAdmin, messagingAgentId, loadConversations]);

  // Handle auto-starting a chat from the dashboard
  const { pendingInternalChatAgentId, setPendingInternalChatAgentId } = useDashboard();
  useEffect(() => {
    if (!pendingInternalChatAgentId) return;
    if (isSuperAdmin && !messagingAgentId) {
      setComposeError(
        'Link a command centre agent profile to your account before messaging agents.',
      );
      return;
    }
    void handleStartChat(pendingInternalChatAgentId);
    setPendingInternalChatAgentId(null);
  }, [
    pendingInternalChatAgentId,
    isSuperAdmin,
    messagingAgentId,
    handleStartChat,
    setPendingInternalChatAgentId,
  ]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || !selectedConvId) return;
    if (!canSendInSelectedConv) return;

    const content = draft.trim();
    setDraft('');
    setComposeError(null);
    try {
      const sentMessage = await sendInternalMessage(selectedConvId, messagingAgentId, content);
      if (sentMessage) {
        setMessages(prev =>
          prev.some((message) => message.id === sentMessage.id)
            ? prev
            : [...prev, sentMessage],
        );
      } else {
        await loadMessages(selectedConvId);
      }
      await loadConversations();
    } catch (error) {
      console.error('Failed to send message', error);
      setComposeError('Failed to send message.');
    }
  };

  const filteredAgents = useMemo(() => {
    const search = agentSearch.toLowerCase();
    return messageableAgents.filter(a => 
      a.name.toLowerCase().includes(search) || a.extension.includes(search)
    );
  }, [messageableAgents, agentSearch]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-2">
          <MessageSquare className="h-8 w-8 text-slate-300" />
          <span className="text-slate-400 text-sm">Loading chats...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-0 w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
      {/* Sidebar */}
      <div className={cn(
        "flex flex-col w-full border-r border-slate-100 bg-slate-50/50 md:w-80",
        selectedConvId && "hidden md:flex"
      )}>
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-900">Messages</h2>
            <Button size="icon" variant="ghost" onClick={() => setShowNewChat(true)} className="rounded-full bg-white shadow-sm hover:bg-slate-50 border border-slate-100">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input 
              placeholder="Search chats..." 
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              className="pl-10 bg-white border-slate-200 rounded-2xl h-10 text-sm focus:ring-emerald-500/20"
            />
          </div>

          {isSuperAdmin && messagingAgentId && (
            <div className="flex gap-1 mb-3 rounded-2xl bg-white p-1 border border-slate-200">
              <Button
                type="button"
                size="sm"
                variant={superAdminListFilter === 'all' ? 'secondary' : 'ghost'}
                className="flex-1 h-8 rounded-xl text-xs font-bold"
                onClick={() => setSuperAdminListFilter('all')}
              >
                All chats
              </Button>
              <Button
                type="button"
                size="sm"
                variant={superAdminListFilter === 'mine' ? 'secondary' : 'ghost'}
                className="flex-1 h-8 rounded-xl text-xs font-bold"
                onClick={() => setSuperAdminListFilter('mine')}
              >
                My messages
              </Button>
            </div>
          )}

          {isSuperAdmin && !messagingAgentId && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mb-3 space-y-2">
              <p>
                Link a command centre agent to your account to send messages, or create a Super Admin chat profile.
                You can still view all agent chats.
              </p>
              {linkError && (
                <p className="text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-2 py-1">
                  {linkError}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold flex-1"
                  onClick={() => {
                    setLinkError(null);
                    setShowLinkPicker(true);
                  }}
                  disabled={linkableAgents.length === 0}
                  title={linkableAgents.length === 0 ? 'No unlinked agents available' : ''}
                >
                  Link existing
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-lg border-amber-300 text-amber-800 hover:bg-amber-100 text-[11px] font-bold flex-1"
                  onClick={handleCreateSuperAdminAgent}
                  disabled={creatingSuperAgent || !(session.tenantId || tenants[0]?.id)}
                >
                  {creatingSuperAgent ? 'Creating…' : 'Create profile'}
                </Button>
              </div>
            </div>
          )}

          {rosterError && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 mb-3">
              {rosterError}
            </div>
          )}

          {(isSuperAdmin ? messagingAgentId : commandCentreAgents.length > 0) && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">
                {isSuperAdmin ? 'Message command centre admin' : 'Quick Message'}
              </label>
              <Select onValueChange={handleStartChat}>
                <SelectTrigger className="w-full bg-white border-slate-200 rounded-2xl h-10 text-sm shadow-sm">
                  <SelectValue placeholder={isSuperAdmin ? 'Select agent...' : 'Select an agent...'} />
                </SelectTrigger>
                <SelectContent className="rounded-2xl border-slate-200 shadow-xl">
                  {messageableAgents.map(agent => (
                      <SelectItem key={agent.id} value={agent.id} className="rounded-xl focus:bg-emerald-50 focus:text-emerald-900 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            agent.status === 'available' ? "bg-emerald-500" : "bg-slate-300"
                          )} />
                          <span>{agent.name}</span>
                          <span className="text-[10px] text-slate-400 font-mono ml-auto">ext {agent.extension}</span>
                        </div>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1">
            {composeError && (
              <div className="px-3 pb-2">
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
                  {composeError}
                </div>
              </div>
            )}

            {filteredConversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
                <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                  <MessageSquare className="h-6 w-6 text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-900">No chats yet</p>
                <p className="text-xs text-slate-500 mt-1">
                  {isSuperAdmin ? 'No conversations match your search.' : 'Start a conversation with another agent.'}
                </p>
              </div>
            ) : (
              filteredConversations.map(conv => {
                const display = resolveConversationDisplay(
                  conv,
                  messagingAgentId,
                  isSuperAdmin,
                );
                const other = {
                  name: display.title,
                  status: display.isOversight ? 'available' : display.subtitle,
                };
                
                return (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedConvId(conv.id)}
                    className={cn(
                      "w-full flex items-start gap-3 p-3 rounded-2xl transition-all duration-200",
                      selectedConvId === conv.id 
                        ? "bg-white shadow-md shadow-emerald-100/50 ring-1 ring-emerald-100" 
                        : "hover:bg-white/80"
                    )}
                  >
                    <div className="relative shrink-0">
                      <Avatar className="h-12 w-12 border-2 border-white shadow-sm">
                        <AvatarFallback className="bg-emerald-50 text-emerald-700 text-sm font-bold">
                          {other?.name?.substring(0, 2).toUpperCase() || '??'}
                        </AvatarFallback>
                      </Avatar>
                      <div className={cn(
                        "absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white",
                        other?.status === 'available' ? "bg-emerald-500" :
                        other?.status === 'on-call' ? "bg-rose-500" : "bg-slate-300"
                      )} />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className={cn(
                          "font-bold text-slate-900 truncate text-sm",
                          conv.unreadCount && conv.unreadCount > 0 && "text-emerald-700"
                        )}>
                          {other.name}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {display.isOversight && (
                            <Eye className="h-3 w-3 text-amber-500 shrink-0" />
                          )}
                          {conv.unreadCount && conv.unreadCount > 0 && (
                            <Badge className="bg-emerald-500 text-white border-none h-4 min-w-[16px] px-1 flex items-center justify-center text-[9px] animate-pulse">
                              {conv.unreadCount}
                            </Badge>
                          )}
                          {conv.last_message_at && (
                            <span className="text-[10px] text-slate-400 tabular-nums">
                              {formatDistanceToNow(new Date(conv.last_message_at), { addSuffix: false })}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className={cn(
                        "text-xs truncate",
                        conv.unreadCount ? "text-emerald-600 font-bold" : "text-slate-500"
                      )}>
                        {conv.last_message || "No messages yet"}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Main Chat Area */}
      <div className={cn(
        "flex flex-col flex-1 bg-white min-w-0",
        !selectedConvId && "hidden md:flex"
      )}>
        {selectedConvId ? (
          <>
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white/80 backdrop-blur-sm z-10 sticky top-0">
              <div className="flex items-center gap-3">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => setSelectedConvId(null)}
                  className="md:hidden"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="relative">
                  <Avatar className="h-10 w-10 border border-slate-100">
                    <AvatarFallback className="bg-emerald-50 text-emerald-700 font-bold text-xs">
                      {selectedConvDisplay?.title?.substring(0, 2).toUpperCase() ?? '??'}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 leading-none mb-1">
                    {selectedConvDisplay?.title}
                  </h3>
                  <div className="flex items-center gap-1.5">
                    <div className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      selectedConvDisplay?.isOversight ? "bg-amber-500" :
                      selectedConvDisplay?.subtitle === 'available' ? "bg-emerald-500" : "bg-slate-300"
                    )} />
                    <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                      {selectedConvDisplay?.isOversight
                        ? 'Viewing agent chat'
                        : selectedConvDisplay?.subtitle || 'Offline'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <ScrollArea className="flex-1 p-6 bg-slate-50/30">
              <div className="space-y-4">
                {messages.map((msg, idx) => {
                  const isMine = msg.sender_id === messagingAgentId;
                  const showAvatar = idx === 0 || messages[idx-1].sender_id !== msg.sender_id;
                  const sender = agentsById.get(msg.sender_id);

                  return (
                    <div 
                      key={msg.id} 
                      className={cn(
                        "flex flex-col",
                        isMine ? "items-end" : "items-start"
                      )}
                    >
                      {!isMine && showAvatar && (
                        <span className="text-[10px] font-bold text-slate-400 ml-10 mb-1">
                          {sender?.name}
                        </span>
                      )}
                      <div className={cn(
                        "flex gap-2 max-w-[80%]",
                        isMine ? "flex-row-reverse" : "flex-row"
                      )}>
                        {!isMine && (
                          <div className="w-8 shrink-0">
                            {showAvatar && (
                              <Avatar className="h-8 w-8 border border-white shadow-sm">
                                <AvatarFallback className="text-[10px] bg-white text-emerald-700">
                                  {sender?.name?.substring(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                            )}
                          </div>
                        )}
                        <div className={cn(
                          "rounded-2xl px-4 py-2.5 text-sm shadow-sm",
                          isMine 
                            ? "bg-emerald-600 text-white rounded-tr-none" 
                            : "bg-white border border-slate-100 text-slate-700 rounded-tl-none"
                        )}>
                          <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                          <div className={cn(
                            "flex items-center justify-end gap-1 mt-1 opacity-70 tabular-nums",
                            isMine ? "text-emerald-50" : "text-slate-400"
                          )}>
                            <span className="text-[9px]">
                              {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {isMine && (msg.is_read ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {canSendInSelectedConv && (
              <div className="p-4 bg-white border-t border-slate-100">
                <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                  <div className="flex-1 relative">
                    <Input 
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      placeholder="Type your message..."
                      className="w-full bg-slate-50 border-transparent rounded-2xl py-6 pl-4 pr-12 focus:bg-white focus:ring-emerald-500/10 transition-all"
                    />
                    <Button 
                      type="submit" 
                      size="icon" 
                      disabled={!draft.trim()}
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-xl bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-200 disabled:opacity-50"
                    >
                      <Send className="h-4 w-4 text-white" />
                    </Button>
                  </div>
                </form>
              </div>
            )}
            
            {isSuperAdmin && !messagingAgentId && (
              <div className="p-3 bg-amber-50 border-t border-amber-100 flex items-center justify-between gap-2 text-amber-700 text-xs font-medium">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4" />
                  Read-only View (Super Admin)
                </div>
                {linkableAgents.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold"
                    onClick={() => {
                      setLinkError(null);
                      setShowLinkPicker(true);
                    }}
                  >
                    Link agent to send
                  </Button>
                )}
              </div>
            )}
            {isSuperAdmin && messagingAgentId && !canSendInSelectedConv && (
              <div className="p-3 bg-amber-50 border-t border-amber-100 flex items-center justify-center gap-2 text-amber-700 text-xs font-medium">
                <Eye className="h-4 w-4" />
                Viewing another agent's conversation
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-slate-50/20">
            <div className="h-20 w-20 rounded-[2.5rem] bg-emerald-50 flex items-center justify-center mb-6 shadow-inner">
              <MessageSquare className="h-10 w-10 text-emerald-500" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Internal Agent Chat</h3>
            <p className="text-slate-500 max-w-xs mb-8">
              Select an agent from the sidebar or start a new conversation to begin chatting.
            </p>
            {!isSuperAdmin && (
              <Button onClick={() => setShowNewChat(true)} className="rounded-2xl px-6 h-12 bg-emerald-600 hover:bg-emerald-700 shadow-xl shadow-emerald-200 font-bold gap-2">
                <Plus className="h-5 w-5" />
                New Chat
              </Button>
            )}
          </div>
        )}
      </div>

      {/* New Chat Dialog/Modal */}
      {showNewChat && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <Card className="w-full max-w-md rounded-[2rem] border-none shadow-2xl overflow-hidden">
            <CardHeader className="bg-emerald-600 text-white p-6">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">Start a new chat</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowNewChat(false)} className="text-white/80 hover:text-white hover:bg-white/10">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </div>
              <div className="mt-4 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-200" />
                <Input 
                  placeholder="Search agents by name or extension..." 
                  value={agentSearch}
                  onChange={e => setAgentSearch(e.target.value)}
                  className="bg-emerald-700/50 border-emerald-500/50 text-white placeholder:text-emerald-300 rounded-xl pl-10 focus:ring-white/20"
                />
              </div>
            </CardHeader>
            <CardContent className="p-2">
              <ScrollArea className="h-80">
                <div className="space-y-1 p-2">
                  {filteredAgents.length === 0 ? (
                    <div className="py-10 text-center text-slate-400 text-sm">
                      No agents found matching "{agentSearch}"
                    </div>
                  ) : (
                    filteredAgents.map(agent => (
                      <button
                        key={agent.id}
                        onClick={() => handleStartChat(agent.id)}
                        className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors"
                      >
                        <Avatar className="h-10 w-10 border border-slate-100">
                          <AvatarFallback className="bg-slate-100 text-slate-600 text-xs font-bold">
                            {agent.name.substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="text-left">
                          <p className="text-sm font-bold text-slate-900">{agent.name}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 font-mono">Ext: {agent.extension}</span>
                            <div className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              agent.status === 'available' ? "bg-emerald-500" : "bg-slate-300"
                            )} />
                            <span className="text-[10px] text-slate-400 uppercase tracking-tighter">{agent.status}</span>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Link super-admin to an agent */}
      {showLinkPicker && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <Card className="w-full max-w-md rounded-[2rem] border-none shadow-2xl overflow-hidden">
            <CardHeader className="bg-amber-600 text-white p-6">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl">Link your account</CardTitle>
                  <p className="text-amber-100 text-xs mt-1">
                    Pick a command centre agent to act as your messaging identity, or create a new Super Admin profile.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowLinkPicker(false)}
                  className="text-white/80 hover:text-white hover:bg-white/10"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </div>
              <Button
                type="button"
                onClick={handleCreateSuperAdminAgent}
                disabled={creatingSuperAgent || !(session.tenantId || tenants[0]?.id)}
                className="mt-4 w-full h-10 rounded-xl bg-white text-amber-700 hover:bg-amber-50 font-bold text-sm"
              >
                {creatingSuperAgent ? 'Creating profile…' : 'Create Super Admin chat profile'}
              </Button>
            </CardHeader>
            <CardContent className="p-2">
              {linkError && (
                <div className="m-2 px-3 py-2 rounded-xl text-xs text-rose-700 bg-rose-50 border border-rose-100">
                  {linkError}
                </div>
              )}
              <ScrollArea className="h-80">
                <div className="space-y-1 p-2">
                  {linkableAgents.length === 0 ? (
                    <div className="py-10 text-center text-slate-400 text-sm">
                      No command centre agents are available to link. Ask a super admin to create one first.
                    </div>
                  ) : (
                    linkableAgents.map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        disabled={linkingAgentId !== null}
                        onClick={() => handleLinkAgent(agent.id)}
                        className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-amber-50 transition-colors disabled:opacity-50"
                      >
                        <Avatar className="h-10 w-10 border border-slate-100">
                          <AvatarFallback className="bg-amber-50 text-amber-700 text-xs font-bold">
                            {agent.name.substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="text-left flex-1">
                          <p className="text-sm font-bold text-slate-900">{agent.name}</p>
                          <span className="text-[10px] text-slate-400 font-mono">Ext: {agent.extension}</span>
                        </div>
                        {linkingAgentId === agent.id && (
                          <span className="text-[11px] text-amber-600 font-bold">Linking…</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
