export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      agent_attendance_events: {
        Row: {
          agent_display_name: string | null
          created_at: string
          event_type: string
          id: string
          occurred_at: string
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          agent_display_name?: string | null
          created_at?: string
          event_type: string
          id?: string
          occurred_at?: string
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          agent_display_name?: string | null
          created_at?: string
          event_type?: string
          id?: string
          occurred_at?: string
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_attendance_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_groups: {
        Row: {
          agent_ids: string[]
          created_at: string
          id: string
          name: string
          queue_id: string
          ring_strategy: Database["public"]["Enums"]["ring_strategy"]
          tenant_id: string
        }
        Insert: {
          agent_ids?: string[]
          created_at?: string
          id: string
          name: string
          queue_id: string
          ring_strategy?: Database["public"]["Enums"]["ring_strategy"]
          tenant_id: string
        }
        Update: {
          agent_ids?: string[]
          created_at?: string
          id?: string
          name?: string
          queue_id?: string
          ring_strategy?: Database["public"]["Enums"]["ring_strategy"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_groups_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "queues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_leave_requests: {
        Row: {
          id: string
          user_id: string
          tenant_id: string | null
          agent_display_name: string | null
          start_date: string
          end_date: string
          duration_type: string
          half_day_part: string | null
          reason: string | null
          status: string
          reviewed_by: string | null
          reviewed_at: string | null
          review_comment: string | null
          attachment_storage_path: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          tenant_id?: string | null
          agent_display_name?: string | null
          start_date: string
          end_date: string
          duration_type: string
          half_day_part?: string | null
          reason?: string | null
          status?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_comment?: string | null
          attachment_storage_path?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          tenant_id?: string | null
          agent_display_name?: string | null
          start_date?: string
          end_date?: string
          duration_type?: string
          half_day_part?: string | null
          reason?: string | null
          status?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_comment?: string | null
          attachment_storage_path?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_leave_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_onboarding: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          invited_at: string
          invited_by: string | null
          notes: string
          personal_email: string
          phone: string
          stage: Database["public"]["Enums"]["agent_onboarding_stage"]
          training_checklist: Json
          updated_at: string
          user_id: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          notes?: string
          personal_email?: string
          phone?: string
          stage?: Database["public"]["Enums"]["agent_onboarding_stage"]
          training_checklist?: Json
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          notes?: string
          personal_email?: string
          phone?: string
          stage?: Database["public"]["Enums"]["agent_onboarding_stage"]
          training_checklist?: Json
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_onboarding_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          allowed_queue_ids: string[]
          assigned_tenant_ids: string[]
          call_start_time: number | null
          created_at: string
          current_caller: string | null
          extension: string
          group_ids: string[]
          id: string
          name: string
          queue_ids: string[]
          role: Database["public"]["Enums"]["agent_role"]
          status: Database["public"]["Enums"]["agent_status"]
          tenant_id: string
          updated_at: string
          user_id: string | null
          workshop_user_role: string | null
        }
        Insert: {
          allowed_queue_ids?: string[]
          assigned_tenant_ids?: string[]
          call_start_time?: number | null
          created_at?: string
          current_caller?: string | null
          extension?: string
          group_ids?: string[]
          id: string
          name: string
          queue_ids?: string[]
          role?: Database["public"]["Enums"]["agent_role"]
          status?: Database["public"]["Enums"]["agent_status"]
          tenant_id: string
          updated_at?: string
          user_id?: string | null
          workshop_user_role?: string | null
        }
        Update: {
          allowed_queue_ids?: string[]
          assigned_tenant_ids?: string[]
          call_start_time?: number | null
          created_at?: string
          current_caller?: string | null
          extension?: string
          group_ids?: string[]
          id?: string
          name?: string
          queue_ids?: string[]
          role?: Database["public"]["Enums"]["agent_role"]
          status?: Database["public"]["Enums"]["agent_status"]
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
          workshop_user_role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          agent_id: string | null
          answer_time: string | null
          caller_name: string | null
          caller_number: string
          created_at: string
          dialed_number: string | null
          direction: string
          duration_seconds: number
          end_time: string | null
          id: string
          queue_id: string
          recording_url: string | null
          result: Database["public"]["Enums"]["call_result"]
          start_time: string
          summary_status: string
          tenant_id: string
          transcript_status: Database["public"]["Enums"]["transcript_status"]
        }
        Insert: {
          agent_id?: string | null
          answer_time?: string | null
          caller_name?: string | null
          caller_number?: string
          created_at?: string
          dialed_number?: string | null
          direction?: string
          duration_seconds?: number
          end_time?: string | null
          id?: string
          queue_id: string
          recording_url?: string | null
          result?: Database["public"]["Enums"]["call_result"]
          start_time?: string
          summary_status?: string
          tenant_id: string
          transcript_status?: Database["public"]["Enums"]["transcript_status"]
        }
        Update: {
          agent_id?: string | null
          answer_time?: string | null
          caller_name?: string | null
          caller_number?: string
          created_at?: string
          dialed_number?: string | null
          direction?: string
          duration_seconds?: number
          end_time?: string | null
          id?: string
          queue_id?: string
          recording_url?: string | null
          result?: Database["public"]["Enums"]["call_result"]
          start_time?: string
          summary_status?: string
          tenant_id?: string
          transcript_status?: Database["public"]["Enums"]["transcript_status"]
        }
        Relationships: [
          {
            foreignKeyName: "calls_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      did_mappings: {
        Row: {
          did: string
          label: string
          queue_id: string
          tenant_id: string
          branch_id: string
          branch_name: string
          owner_id: string
          workshop_name: string
        }
        Insert: {
          did: string
          label?: string
          queue_id: string
          tenant_id: string
          branch_id?: string
          branch_name?: string
          owner_id?: string
          workshop_name?: string
        }
        Update: {
          did?: string
          label?: string
          queue_id?: string
          tenant_id?: string
          branch_id?: string
          branch_name?: string
          owner_id?: string
          workshop_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "did_mappings_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "queues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "did_mappings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string
          id: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      queues: {
        Row: {
          active_calls: number
          available_agents: number
          avg_wait_seconds: number
          color: string
          created_at: string
          icon: string
          id: string
          name: string
          sla_percent: number
          tenant_id: string
          total_agents: number
          type: string
          updated_at: string
          waiting_calls: number
        }
        Insert: {
          active_calls?: number
          available_agents?: number
          avg_wait_seconds?: number
          color?: string
          created_at?: string
          icon?: string
          id: string
          name: string
          sla_percent?: number
          tenant_id: string
          total_agents?: number
          type?: string
          updated_at?: string
          waiting_calls?: number
        }
        Update: {
          active_calls?: number
          available_agents?: number
          avg_wait_seconds?: number
          color?: string
          created_at?: string
          icon?: string
          id?: string
          name?: string
          sla_percent?: number
          tenant_id?: string
          total_agents?: number
          type?: string
          updated_at?: string
          waiting_calls?: number
        }
        Relationships: [
          {
            foreignKeyName: "queues_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sip_lines: {
        Row: {
          active_caller: string | null
          active_since: number | null
          created_at: string
          id: string
          label: string
          status: Database["public"]["Enums"]["sip_line_status"]
          tenant_id: string | null
          trunk_name: string
        }
        Insert: {
          active_caller?: string | null
          active_since?: number | null
          created_at?: string
          id: string
          label?: string
          status?: Database["public"]["Enums"]["sip_line_status"]
          tenant_id?: string | null
          trunk_name?: string
        }
        Update: {
          active_caller?: string | null
          active_since?: number | null
          created_at?: string
          id?: string
          label?: string
          status?: Database["public"]["Enums"]["sip_line_status"]
          tenant_id?: string | null
          trunk_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "sip_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_agent_suburb_assignments: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          suburb: string
          tenant_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          suburb: string
          tenant_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          suburb?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_agent_suburb_assignments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_agent_suburb_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_campaigns: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_commission_events: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          lead_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          lead_id: string
          status?: string
          tenant_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_commission_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sales_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_commission_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_lead_interactions: {
        Row: {
          agent_id: string | null
          created_at: string
          customer_response: string
          id: string
          lead_id: string
          notes: string
          outcome: Database["public"]["Enums"]["lead_call_outcome"]
          tenant_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          customer_response?: string
          id?: string
          lead_id: string
          notes?: string
          outcome: Database["public"]["Enums"]["lead_call_outcome"]
          tenant_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          customer_response?: string
          id?: string
          lead_id?: string
          notes?: string
          outcome?: Database["public"]["Enums"]["lead_call_outcome"]
          tenant_id?: string
        }
        Relationships: []
      }
      sales_leads: {
        Row: {
          assigned_agent_id: string | null
          campaign_id: string | null
          created_at: string
          customer_response_summary: string
          display_name: string
          do_not_call: boolean
          email: string | null
          first_called_at: string | null
          follow_up_at: string | null
          id: string
          journey_stage: Database["public"]["Enums"]["lead_journey_stage"]
          last_contacted_at: string | null
          notes: string
          phone: string
          suburb: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          assigned_agent_id?: string | null
          campaign_id?: string | null
          created_at?: string
          customer_response_summary?: string
          display_name?: string
          do_not_call?: boolean
          email?: string | null
          first_called_at?: string | null
          follow_up_at?: string | null
          id?: string
          journey_stage?: Database["public"]["Enums"]["lead_journey_stage"]
          last_contacted_at?: string | null
          notes?: string
          phone?: string
          suburb?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          assigned_agent_id?: string | null
          campaign_id?: string | null
          created_at?: string
          customer_response_summary?: string
          display_name?: string
          do_not_call?: boolean
          email?: string | null
          first_called_at?: string | null
          follow_up_at?: string | null
          id?: string
          journey_stage?: Database["public"]["Enums"]["lead_journey_stage"]
          last_contacted_at?: string | null
          notes?: string
          phone?: string
          suburb?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      sales_site_visits: {
        Row: {
          agent_id: string | null
          booked_at: string
          created_at: string
          id: string
          lead_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          agent_id?: string | null
          booked_at?: string
          created_at?: string
          id?: string
          lead_id: string
          status?: string
          tenant_id: string
        }
        Update: {
          agent_id?: string | null
          booked_at?: string
          created_at?: string
          id?: string
          lead_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      sales_suburb_workshops: {
        Row: {
          created_at: string
          id: string
          location: string
          owner_email: string
          owner_name: string
          phone_number: string
          suburb: string
          suburb_normalized: string
          tenant_id: string
          updated_at: string
          website: string
          workshop_name: string
        }
        Insert: {
          created_at?: string
          id?: string
          location?: string
          owner_email?: string
          owner_name?: string
          phone_number?: string
          suburb: string
          tenant_id: string
          updated_at?: string
          website?: string
          workshop_name?: string
        }
        Update: {
          created_at?: string
          id?: string
          location?: string
          owner_email?: string
          owner_name?: string
          phone_number?: string
          suburb?: string
          tenant_id?: string
          updated_at?: string
          website?: string
          workshop_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_suburb_workshops_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_suburb_workshop_agent_contact: {
        Row: {
          agent_id: string
          call_status: string | null
          created_at: string
          first_called_at: string | null
          follow_up_at: string | null
          id: string
          remarks: string
          tenant_id: string
          updated_at: string
          workshop_id: string
        }
        Insert: {
          agent_id: string
          call_status?: string | null
          created_at?: string
          first_called_at?: string | null
          follow_up_at?: string | null
          id?: string
          remarks?: string
          tenant_id: string
          updated_at?: string
          workshop_id: string
        }
        Update: {
          agent_id?: string
          call_status?: string | null
          created_at?: string
          first_called_at?: string | null
          follow_up_at?: string | null
          id?: string
          remarks?: string
          tenant_id?: string
          updated_at?: string
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_suburb_workshop_agent_contact_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_trials: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          lead_id: string
          started_at: string
          status: string
          tenant_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          lead_id: string
          started_at?: string
          status?: string
          tenant_id?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          started_at?: string
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      tenant_onboarding: {
        Row: {
          activity_log: Json
          booking_rules: Json
          business_rules: Json
          client_details: Json
          contact_email: string
          contact_name: string
          contact_phone: string
          created_at: string
          created_by: string
          id: string
          notes: string
          onboarding_stage: Database["public"]["Enums"]["onboarding_stage"]
          queue_setup: Json
          script_knowledge_base: Json
          testing_go_live: Json
          updated_at: string
        }
        Insert: {
          activity_log?: Json
          booking_rules?: Json
          business_rules?: Json
          client_details?: Json
          contact_email?: string
          contact_name?: string
          contact_phone?: string
          created_at?: string
          created_by?: string
          id: string
          notes?: string
          onboarding_stage?: Database["public"]["Enums"]["onboarding_stage"]
          queue_setup?: Json
          script_knowledge_base?: Json
          testing_go_live?: Json
          updated_at?: string
        }
        Update: {
          activity_log?: Json
          booking_rules?: Json
          business_rules?: Json
          client_details?: Json
          contact_email?: string
          contact_name?: string
          contact_phone?: string
          created_at?: string
          created_by?: string
          id?: string
          notes?: string
          onboarding_stage?: Database["public"]["Enums"]["onboarding_stage"]
          queue_setup?: Json
          script_knowledge_base?: Json
          testing_go_live?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_onboarding_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          bms_default_branch_id: string | null
          bms_owner_uid: string | null
          brand_color: string
          created_at: string
          did_numbers: string[]
          id: string
          industry: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          bms_default_branch_id?: string | null
          bms_owner_uid?: string | null
          brand_color?: string
          created_at?: string
          did_numbers?: string[]
          id: string
          industry?: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          bms_default_branch_id?: string | null
          bms_owner_uid?: string | null
          brand_color?: string
          created_at?: string
          did_numbers?: string[]
          id?: string
          industry?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      sms_contacts: {
        Row: {
          id: string
          contact_type: string
          display_name: string
          phone: string
          owner_uid: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          contact_type: string
          display_name: string
          phone: string
          owner_uid?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          contact_type?: string
          display_name?: string
          phone?: string
          owner_uid?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_user_tenant: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      apply_sales_lead_outcome: {
        Args: {
          p_customer_response?: string
          p_follow_up_at?: string | null
          p_lead_id: string
          p_notes?: string
          p_outcome: Database["public"]["Enums"]["lead_call_outcome"]
        }
        Returns: Json
      }
      mark_sales_lead_called: {
        Args: { p_lead_id: string }
        Returns: Json
      }
      mark_sales_suburb_workshop_called: {
        Args: { p_workshop_id: string }
        Returns: Json
      }
      update_sales_suburb_workshop_remarks: {
        Args: { p_workshop_id: string; p_remarks: string }
        Returns: Json
      }
      set_sales_suburb_workshop_follow_up: {
        Args: { p_follow_up_at: string | null; p_workshop_id: string }
        Returns: Json
      }
      set_sales_suburb_workshop_call_status: {
        Args: { p_workshop_id: string; p_status: string | null }
        Returns: Json
      }
    }
    Enums: {
      agent_onboarding_stage:
        | "invited"
        | "account-created"
        | "training"
        | "shadowing"
        | "live"
      agent_role: "agent" | "senior-agent" | "team-lead"
      agent_status: "on-call" | "available" | "wrap-up" | "break" | "offline"
      app_role: "super-admin" | "client-admin" | "supervisor" | "agent"
      call_result: "answered" | "abandoned" | "missed" | "voicemail"
      lead_call_outcome:
        | "no_answer"
        | "answered_short"
        | "not_interested"
        | "interested"
        | "trial_offered"
        | "trial_started"
        | "site_visit_booked"
        | "call_back_later"
        | "converted"
      lead_journey_stage:
        | "assigned"
        | "called"
        | "answered"
        | "interested"
        | "trial_offered"
        | "trial_started"
        | "site_visit_booked"
        | "converted"
      onboarding_stage:
        | "new"
        | "contacted"
        | "discovery-complete"
        | "tenant-created"
        | "queue-setup-complete"
        | "script-setup-complete"
        | "testing"
        | "awaiting-approval"
        | "live"
        | "needs-revision"
      ring_strategy: "ring-all" | "round-robin" | "longest-idle"
      sip_line_status: "active" | "idle" | "error"
      transcript_status: "pending" | "processing" | "ready" | "none"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      agent_onboarding_stage: [
        "invited",
        "account-created",
        "training",
        "shadowing",
        "live",
      ],
      agent_role: ["agent", "senior-agent", "team-lead"],
      agent_status: ["on-call", "available", "wrap-up", "break", "offline"],
      app_role: ["super-admin", "client-admin", "supervisor", "agent"],
      call_result: ["answered", "abandoned", "missed", "voicemail"],
      onboarding_stage: [
        "new",
        "contacted",
        "discovery-complete",
        "tenant-created",
        "queue-setup-complete",
        "script-setup-complete",
        "testing",
        "awaiting-approval",
        "live",
        "needs-revision",
      ],
      lead_call_outcome: [
        "no_answer",
        "answered_short",
        "not_interested",
        "interested",
        "trial_offered",
        "trial_started",
        "site_visit_booked",
        "call_back_later",
        "converted",
      ],
      lead_journey_stage: [
        "assigned",
        "called",
        "answered",
        "interested",
        "trial_offered",
        "trial_started",
        "site_visit_booked",
        "converted",
      ],
      ring_strategy: ["ring-all", "round-robin", "longest-idle"],
      sip_line_status: ["active", "idle", "error"],
      transcript_status: ["pending", "processing", "ready", "none"],
    },
  },
} as const
