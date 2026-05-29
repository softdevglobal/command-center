/* ═══════════════════════════════════════════════════════════════
   Domain Model — Multi-Tenant Call Centre
   Every entity carries tenantId for strict isolation.
   ═══════════════════════════════════════════════════════════════ */

export type UserRole = "super-admin" | "client-admin" | "supervisor" | "agent";

export type AgentStatus =
  | "ringing"
  | "on-call"
  | "available"
  | "wrap-up"
  | "break"
  | "offline";

export type CallResult = "answered" | "abandoned" | "missed" | "voicemail";

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

export type TranscriptStatus = "pending" | "processing" | "ready" | "none";

export type SipLineStatus = "active" | "idle" | "error";

export interface Tenant {
  id: string;
  name: string;
  industry: string;
  status: "active" | "inactive";
  brandColor: string;
  didNumbers: string[];
  /** BMS workshop Firebase owner UID for `/api/call-center` (set per tenant in DB). */
  bmsOwnerUid?: string | null;
  /** Default BMS branch when not provided by DID mapping or navigation. */
  bmsDefaultBranchId?: string | null;
}

export interface Queue {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  color: string;
  icon: string;
  activeCalls: number;
  waitingCalls: number;
  availableAgents: number;
  totalAgents: number;
  avgWaitSeconds: number;
  slaPercent: number;
}

/** Role of the user at the workshop extension (BMS), not the call-centre hierarchy. */
export type WorkshopUserRole = "owner" | "branch_admin" | "staff";

export interface Agent {
  id: string;
  /** Supabase auth user id when this row is linked to a login account. */
  userId?: string | null;
  tenantId: string;
  queueIds: string[];
  name: string;
  extension: string;
  email?: string;
  phone?: string;
  notes?: string;
  /** BMS workshop owner UID chosen during onboarding. */
  bmsOwnerUid?: string | null;
  /** BMS workshop branch id chosen during onboarding. */
  bmsBranchId?: string | null;
  /**
   * Workshop-side role for this extension (owner / branch admin / staff).
   * Distinct from `role`, which is the call-centre agent tier.
   */
  workshopUserRole?: WorkshopUserRole | null;
  role: "agent" | "senior-agent" | "team-lead";
  status: AgentStatus;
  currentCaller: string | null;
  callStartTime: number | null;
  allowedQueueIds: string[];
  assignedTenantIds: string[];
  groupIds: string[];
  queueName?: string;
  tenantName?: string;
}

export interface Call {
  id: string;
  tenantId: string;
  queueId: string;
  agentId: string | null;
  /** inbound = customer called the centre; outbound = agent dialled the customer (CDR). */
  direction: "inbound" | "outbound";
  /** Customer / inbound caller number (CLI). */
  callerNumber: string;
  callerName: string | null;
  /** Tenant inbound DID — the number the caller dialled to reach this tenant (Yeastar CDR). */
  dialedNumber: string | null;
  startTime: string;
  answerTime: string | null;
  endTime: string | null;
  durationSeconds: number;
  result: CallResult;
  recordingUrl: string | null;
  transcriptStatus: TranscriptStatus;
  summaryStatus: "pending" | "ready" | "none";
  agentName: string;
  queueName: string;
  tenantName: string;
}

export interface SipLine {
  id: string;
  tenantId: string | null;
  label: string;
  trunkName: string;
  status: SipLineStatus;
  activeCaller: string | null;
  activeSince: number | null;
  tenantName?: string;
}

export interface CustomerRecord {
  id: string;
  tenantId: string;
  name: string;
  primaryPhone: string;
  phoneNormalized: string;
  email: string | null;
  address: string | null;
  notes: string | null;
}

export interface VehicleRecord {
  id: string;
  tenantId: string;
  customerId: string;
  rego: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  vin: string | null;
  notes: string | null;
}

export interface ServiceRecord {
  id: string;
  tenantId: string;
  customerId: string;
  vehicleId: string;
  serviceDate: string;
  serviceType: string;
  odometerKm: number | null;
  amount: number | null;
  advisorNotes: string | null;
}

export interface CallerContext {
  customer: CustomerRecord;
  vehicles: VehicleRecord[];
  services: ServiceRecord[];
}

export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";

export interface BookingRecord {
  id: string;
  tenantId: string;
  customerId: string | null;
  vehicleId: string | null;
  vehicleRego: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleYear: number | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  serviceType: string;
  bookingDate: string;
  dropOffTime: string;
  pickupTime: string | null;
  notes: string | null;
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UserSession {
  userId: string;
  role: UserRole;
  tenantId: string | null;
  allowedQueueIds: string[];
  displayName: string;
  /** Sign-in email — used for Linkus before the agents roster is loaded. */
  authEmail?: string | null;
}

export interface DashboardSummary {
  activeCalls: number;
  queuedCalls: number;
  availableAgents: number;
  onlineAgents: number;
  totalCallsToday: number;
  answerRate: number;
  abandonRate: number;
  avgHandleTime: number;
  slaPercent: number;
}

/* ═══════════════════════════════════════════════════════════════
   Onboarding Stages — 10-Stage Workflow
   ═══════════════════════════════════════════════════════════════ */

export type OnboardingStage =
  | "new"
  | "contacted"
  | "discovery-complete"
  | "tenant-created"
  | "queue-setup-complete"
  | "script-setup-complete"
  | "testing"
  | "awaiting-approval"
  | "live"
  | "needs-revision";

/* ═══════════════════════════════════════════════════════════════
   Onboarding Section Data Models
   ═══════════════════════════════════════════════════════════════ */

export interface BusinessHours {
  day:
    | "monday"
    | "tuesday"
    | "wednesday"
    | "thursday"
    | "friday"
    | "saturday"
    | "sunday";
  open: string; // HH:mm
  close: string; // HH:mm
  closed: boolean;
}

export interface AgentShiftSchedule {
  id: string;
  agentId: string;
  monday: string | null;
  tuesday: string | null;
  wednesday: string | null;
  thursday: string | null;
  friday: string | null;
  saturday: string | null;
  sunday: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ClientLocation {
  name: string;
  address: string;
  phone: string;
  businessHours: BusinessHours[];
}

export interface ClientDetails {
  businessName: string;
  abn: string;
  industry: string;
  timezone: string;
  primaryContactName: string;
  primaryContactPhone: string;
  primaryContactEmail: string;
  billingContactName: string;
  billingContactEmail: string;
  primaryManagerName: string;
  primaryManagerPhone: string;
  primaryManagerEmail: string;
  afterHoursPhone: string;
  businessHours: BusinessHours[];
  locations: ClientLocation[];
  serviceArea: string;
  website: string;
}

export type AfterHoursAction = "voicemail" | "transfer" | "message" | "none";

export interface BusinessRules {
  urgentKeywords: string[];
  escalationContactName: string;
  escalationContactPhone: string;
  escalationContactEmail: string;
  afterHoursEnabled: boolean;
  afterHoursAction: AfterHoursAction;
  afterHoursTransferNumber: string;
  afterHoursVoicemailGreeting: string;
  approvalRequired: boolean;
  approverName: string;
  approverPhone: string;
  approverEmail: string;
  complaintEscalationEnabled: boolean;
  complaintEscalationPath: string;
  complaintEscalationContact: string;
  transferRules: TransferRule[];
  allowedServices: string[];
  excludedServices: string[];
}

export interface TransferRule {
  trigger: string;
  destination: string;
  destinationNumber: string;
}

export interface OnboardingQueue {
  id: string;
  name: string;
  purpose: string;
  businessHoursRule: string;
  afterHoursRule: string;
  fallbackAction: string;
  fallbackNumber: string;
  priority: number;
  assignedAgentIds: string[];
  routingPath: string;
}

export interface QueueSetup {
  queues: OnboardingQueue[];
}

export interface ScriptKnowledgeBase {
  greeting: string;
  faqAnswers: FaqEntry[];
  objectionHandling: string;
  complianceWording: string;
  escalationWording: string;
  pricingNotes: string;
  servicesScript: string;
  closingScript: string;
  approvedByClient: boolean;
  approvedAt: string;
  approvedBy: string;
}

export interface FaqEntry {
  question: string;
  answer: string;
}

export interface BookingRules {
  requiredCallerFields: string[];
  requiredJobFields: string[];
  depositRequired: boolean;
  depositAmount: string;
  depositWorkflow: string;
  managerApprovalRequired: boolean;
  managerContactName: string;
  managerContactPhone: string;
  calendarIntegrationEnabled: boolean;
  calendarConnected: boolean;
  calendarProvider: string;
  smsConfirmationEnabled: boolean;
  smsSenderConfigured: boolean;
  smsSenderId: string;
  cancellationPolicy: string;
  rescheduleRules: string;
  allowBookingsOutsideHours: boolean;
  outsideHoursBookingRule: string;
}

export interface TestCall {
  id: string;
  timestamp: string;
  testerName: string;
  scenario: string;
  result: "pass" | "fail" | "partial";
  notes: string;
  queueTested: string;
}

export interface TestingGoLive {
  testCalls: TestCall[];
  allTestsPassed: boolean;
  routingVerified: boolean;
  queueConfigVerified: boolean;
  clientApprovalReceived: boolean;
  clientApprovalTimestamp: string;
  clientApprovalBy: string;
  scriptApprovalReceived: boolean;
  scriptApprovalTimestamp: string;
  rollbackPlan: string;
  handoverNotes: string;
  assignedLiveOpsTeam: string;
  goLiveDate: string;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string;
  section: string;
  details: string;
  previousValue: string;
  newValue: string;
}

/* ═══════════════════════════════════════════════════════════════
   Onboarding Entity — Full Model
   ═══════════════════════════════════════════════════════════════ */

export interface TenantOnboarding extends Tenant {
  onboardingStage: OnboardingStage;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  createdBy: string;
  createdAt: string;
  notes: string;
  clientDetails: ClientDetails;
  businessRules: BusinessRules;
  queueSetup: QueueSetup;
  scriptKnowledgeBase: ScriptKnowledgeBase;
  bookingRules: BookingRules;
  testingGoLive: TestingGoLive;
  activityLog: ActivityLogEntry[];
}

export interface NewClientForm {
  businessName: string;
  industry: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  brandColor: string;
  notes: string;
}

export interface Permissions {
  canViewAllTenants: boolean;
  canSwitchTenant: boolean;
  canViewSipInfrastructure: boolean;
  canViewTenantNames: boolean;
  canViewCallsTab: boolean;
  canViewBookingsTab: boolean;
  canViewAgentsTab: boolean;
  /** Workshop / agent messaging (Chat tab). */
  canViewChatTab: boolean;
  canViewInternalChat: boolean;
  canViewOverviewTab: boolean;
  canViewSipTab: boolean;
  canViewClientsTab: boolean;
  canSignUpClients: boolean;
  canAdvanceOnboarding: boolean;
  canEditClientDetails: boolean;
  canApproveGoLive: boolean;
  canRegressStage: boolean;
  canViewShiftPanel: boolean;
  /** Clock in/out & breaks (agents); live roster (super-admin). */
  canViewAttendanceTab: boolean;
  canOnboardAgents: boolean;
  canViewAgentOnboarding: boolean;
  canViewAgentOnboardingTab: boolean;
  canViewAuditLogs: boolean;
  /** Super-admin only: play or download Yeastar call recordings on the Calls tab. */
  canViewCallRecordings: boolean;
  /** Super-admin only: edit or remove agents from the Agents tab. */
  canManageAgents: boolean;
  /** Super-admin only: view & manage DID ↔ workshop/branch mappings. */
  canManageDIDMappings: boolean;
  /** CRM-style sales workspace (tenant-scoped) for super-admin, client-admin, supervisor. */
  canViewSalesAdminSuite: boolean;
  /** Assigned-lead workflows: call list, follow-ups, pipeline, performance (agents). */
  canViewSalesAgentSuite: boolean;
  allowedTenantId: string | null;
  allowedQueueIds: string[];
}

/* ═══════════════════════════════════════════════════════════════
   Agent Groups & DID Routing
   ═══════════════════════════════════════════════════════════════ */

export type RingStrategy = "ring-all" | "round-robin" | "longest-idle";

export interface AgentGroup {
  id: string;
  name: string;
  tenantId: string;
  queueId: string;
  agentIds: string[];
  ringStrategy: RingStrategy;
}

export interface DIDMapping {
  did: string;
  tenantId: string;
  queueId: string;
  label: string;
  branchId: string;
  branchName: string;
  mappingWorkshopName: string;
  ownerId: string;
}

export type IncomingCallStatus = "ringing" | "queued" | "answered" | "ended";

export interface IncomingCall {
  id: string;
  did: string;
  callerNumber: string;
  callerName: string | null;
  tenantId: string;
  tenantName: string;
  tenantBrandColor: string;
  queueId: string;
  queueName: string;
  groupId: string;
  groupName: string;
  didLabel: string;
  branchId: string;
  branchName: string;
  mappingWorkshopName: string;
  ownerId: string;
  waitingSince: number;
  status: IncomingCallStatus;
}

export interface TabDef {
  key: string;
  label: string;
  icon: string;
}

/* ═══════════════════════════════════════════════════════════════
   Agent Onboarding
   ═══════════════════════════════════════════════════════════════ */

export type AgentOnboardingStage =
  | "invited"
  | "account-created"
  | "training"
  | "shadowing"
  | "live";

export interface TrainingChecklist {
  pbxLogin: boolean;
  scriptReview: boolean;
  testCalls: boolean;
  systemNav: boolean;
}

export interface AgentOnboarding {
  id: string;
  agentId: string;
  userId: string | null;
  stage: AgentOnboardingStage;
  invitedBy: string | null;
  invitedAt: string;
  personalEmail: string;
  phone: string;
  notes: string;
  trainingChecklist: TrainingChecklist;
  createdAt: string;
  updatedAt: string;
  // Joined
  agentName: string;
  agentExtension: string;
  agentTenantId: string;
  agentQueueIds: string[];
  agentGroupIds: string[];
  agentStatus: string;
  tenantName: string;
}

export interface NewAgentForm {
  name: string;
  email: string;
  phone: string;
  password: string;
  tenantId: string;
  queueIds: string[];
  groupIds: string[];
  extension: string;
  notes: string;
}

/* ═══════════════════════════════════════════════════════════════
   Validation Types
   ═══════════════════════════════════════════════════════════════ */

export type ValidationSeverity = "blocker" | "warning";

export interface ValidationResult {
  valid: boolean;
  blockers: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ValidationIssue {
  section: string;
  field: string;
  message: string;
  severity: ValidationSeverity;
}

export interface StageTransitionResult {
  allowed: boolean;
  blockers: ValidationIssue[];
  warnings: ValidationIssue[];
  targetStage: OnboardingStage;
}
