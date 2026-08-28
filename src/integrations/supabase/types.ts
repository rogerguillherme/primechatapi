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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      account_templates: {
        Row: {
          account_id: string
          created_at: string
          id: string
          template_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          template_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_templates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_templates_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "chat_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_feedback: {
        Row: {
          agent_id: string
          bad_reply: string | null
          created_at: string
          good_reply: string
          id: string
          note: string | null
          user_id: string
          user_message: string
        }
        Insert: {
          agent_id: string
          bad_reply?: string | null
          created_at?: string
          good_reply: string
          id?: string
          note?: string | null
          user_id: string
          user_message: string
        }
        Update: {
          agent_id?: string
          bad_reply?: string | null
          created_at?: string
          good_reply?: string
          id?: string
          note?: string | null
          user_id?: string
          user_message?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_feedback_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agents: {
        Row: {
          active: boolean | null
          ai_model: string | null
          created_at: string
          faq: Json | null
          guidelines: string | null
          id: string
          identity: string | null
          instructions: string | null
          knowledge: string | null
          max_interactions: number | null
          name: string
          updated_at: string
          user_id: string
          voice: string | null
          voice_accent: number | null
          voice_similarity: number | null
          voice_speed: number | null
          voice_stability: number | null
        }
        Insert: {
          active?: boolean | null
          ai_model?: string | null
          created_at?: string
          faq?: Json | null
          guidelines?: string | null
          id?: string
          identity?: string | null
          instructions?: string | null
          knowledge?: string | null
          max_interactions?: number | null
          name: string
          updated_at?: string
          user_id: string
          voice?: string | null
          voice_accent?: number | null
          voice_similarity?: number | null
          voice_speed?: number | null
          voice_stability?: number | null
        }
        Update: {
          active?: boolean | null
          ai_model?: string | null
          created_at?: string
          faq?: Json | null
          guidelines?: string | null
          id?: string
          identity?: string | null
          instructions?: string | null
          knowledge?: string | null
          max_interactions?: number | null
          name?: string
          updated_at?: string
          user_id?: string
          voice?: string | null
          voice_accent?: number | null
          voice_similarity?: number | null
          voice_speed?: number | null
          voice_stability?: number | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          record_id: string | null
          table_name: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          record_id?: string | null
          table_name?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          record_id?: string | null
          table_name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      broadcast_jobs: {
        Row: {
          account_id: string
          account_ids: string[] | null
          auto_paused_by_system: boolean
          campaign_name: string | null
          consecutive_errors: number
          created_at: string
          delay_max_seconds: number
          delay_min_seconds: number
          delivered_count: number
          error_count: number
          error_rate: number
          id: string
          last_cursor: number
          last_error: string | null
          lead_ids: string[]
          messages_per_second: number
          multi_number: boolean
          pause_reason: string | null
          read_count: number
          retry_map: Json | null
          risk_check_passed: boolean
          risk_check_reason: string | null
          scheduled_at: string | null
          sent_count: number
          shuffle_leads: boolean
          status: string
          template_id: string | null
          template_language: string | null
          template_name: string | null
          template_params: Json | null
          total_leads: number
          updated_at: string
          user_id: string
          warmup_daily_limit: number | null
          warmup_day: number | null
          warmup_mode: boolean
        }
        Insert: {
          account_id: string
          account_ids?: string[] | null
          auto_paused_by_system?: boolean
          campaign_name?: string | null
          consecutive_errors?: number
          created_at?: string
          delay_max_seconds?: number
          delay_min_seconds?: number
          delivered_count?: number
          error_count?: number
          error_rate?: number
          id?: string
          last_cursor?: number
          last_error?: string | null
          lead_ids?: string[]
          messages_per_second?: number
          multi_number?: boolean
          pause_reason?: string | null
          read_count?: number
          retry_map?: Json | null
          risk_check_passed?: boolean
          risk_check_reason?: string | null
          scheduled_at?: string | null
          sent_count?: number
          shuffle_leads?: boolean
          status?: string
          template_id?: string | null
          template_language?: string | null
          template_name?: string | null
          template_params?: Json | null
          total_leads?: number
          updated_at?: string
          user_id: string
          warmup_daily_limit?: number | null
          warmup_day?: number | null
          warmup_mode?: boolean
        }
        Update: {
          account_id?: string
          account_ids?: string[] | null
          auto_paused_by_system?: boolean
          campaign_name?: string | null
          consecutive_errors?: number
          created_at?: string
          delay_max_seconds?: number
          delay_min_seconds?: number
          delivered_count?: number
          error_count?: number
          error_rate?: number
          id?: string
          last_cursor?: number
          last_error?: string | null
          lead_ids?: string[]
          messages_per_second?: number
          multi_number?: boolean
          pause_reason?: string | null
          read_count?: number
          retry_map?: Json | null
          risk_check_passed?: boolean
          risk_check_reason?: string | null
          scheduled_at?: string | null
          sent_count?: number
          shuffle_leads?: boolean
          status?: string
          template_id?: string | null
          template_language?: string | null
          template_name?: string | null
          template_params?: Json | null
          total_leads?: number
          updated_at?: string
          user_id?: string
          warmup_daily_limit?: number | null
          warmup_day?: number | null
          warmup_mode?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_jobs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_jobs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "chat_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_events: {
        Row: {
          campaign_id: string
          created_at: string
          event_type: string
          id: string
          lead_id: string | null
          lead_phone: string | null
          metadata: Json | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          event_type?: string
          id?: string
          lead_id?: string | null
          lead_phone?: string | null
          metadata?: Json | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          event_type?: string
          id?: string
          lead_id?: string | null
          lead_phone?: string | null
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "broadcast_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_risk_profiles: {
        Row: {
          block_count: number
          block_rate: number
          campaign_id: string
          created_at: string
          delivered_count: number
          delivery_rate: number
          id: string
          last_calculated_at: string
          quality_impact_score: number
          read_count: number
          read_rate: number
          reply_count: number
          reply_rate: number
          risk_level: string
          sent_count: number
          spam_signal_count: number
          template_ids: string[]
          unsubscribe_count: number
          unsubscribe_rate: number
          updated_at: string
          user_id: string
        }
        Insert: {
          block_count?: number
          block_rate?: number
          campaign_id: string
          created_at?: string
          delivered_count?: number
          delivery_rate?: number
          id?: string
          last_calculated_at?: string
          quality_impact_score?: number
          read_count?: number
          read_rate?: number
          reply_count?: number
          reply_rate?: number
          risk_level?: string
          sent_count?: number
          spam_signal_count?: number
          template_ids?: string[]
          unsubscribe_count?: number
          unsubscribe_rate?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          block_count?: number
          block_rate?: number
          campaign_id?: string
          created_at?: string
          delivered_count?: number
          delivery_rate?: number
          id?: string
          last_calculated_at?: string
          quality_impact_score?: number
          read_count?: number
          read_rate?: number
          reply_count?: number
          reply_rate?: number
          risk_level?: string
          sent_count?: number
          spam_signal_count?: number
          template_ids?: string[]
          unsubscribe_count?: number
          unsubscribe_rate?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_labels: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          stage_id: string | null
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          stage_id?: string | null
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          stage_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_labels_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          account_id: string | null
          content: string
          created_at: string
          delivered_at: string | null
          direction: string
          error_code: string | null
          error_details: string | null
          error_title: string | null
          id: string
          lead_id: string
          media_type: string | null
          media_url: string | null
          quoted_message: Json | null
          read_at: string | null
          status: string
          zapi_message_id: string | null
        }
        Insert: {
          account_id?: string | null
          content: string
          created_at?: string
          delivered_at?: string | null
          direction: string
          error_code?: string | null
          error_details?: string | null
          error_title?: string | null
          id?: string
          lead_id: string
          media_type?: string | null
          media_url?: string | null
          quoted_message?: Json | null
          read_at?: string | null
          status?: string
          zapi_message_id?: string | null
        }
        Update: {
          account_id?: string | null
          content?: string
          created_at?: string
          delivered_at?: string | null
          direction?: string
          error_code?: string | null
          error_details?: string | null
          error_title?: string | null
          id?: string
          lead_id?: string
          media_type?: string | null
          media_url?: string | null
          quoted_message?: Json | null
          read_at?: string | null
          status?: string
          zapi_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_shortcuts: {
        Row: {
          action_type: string
          active: boolean
          command: string
          created_at: string
          description: string | null
          flow_id: string | null
          id: string
          message: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          action_type?: string
          active?: boolean
          command: string
          created_at?: string
          description?: string | null
          flow_id?: string | null
          id?: string
          message?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          action_type?: string
          active?: boolean
          command?: string
          created_at?: string
          description?: string | null
          flow_id?: string | null
          id?: string
          message?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_shortcuts_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_templates: {
        Row: {
          category: string | null
          content: string
          created_at: string
          id: string
          meta_status: string | null
          name: string
          spam_risk_level: string
          spam_score: number
          template_language: string | null
          template_name: string | null
          template_params: Json | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string
          id?: string
          meta_status?: string | null
          name: string
          spam_risk_level?: string
          spam_score?: number
          template_language?: string | null
          template_name?: string | null
          template_params?: Json | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string
          id?: string
          meta_status?: string | null
          name?: string
          spam_risk_level?: string
          spam_score?: number
          template_language?: string | null
          template_name?: string | null
          template_params?: Json | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      click_tracking_links: {
        Row: {
          campaign_id: string
          click_count: number
          clicked_at: string | null
          created_at: string
          id: string
          lead_id: string | null
          lead_phone: string | null
          original_url: string
          short_code: string
        }
        Insert: {
          campaign_id: string
          click_count?: number
          clicked_at?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          lead_phone?: string | null
          original_url: string
          short_code: string
        }
        Update: {
          campaign_id?: string
          click_count?: number
          clicked_at?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          lead_phone?: string | null
          original_url?: string
          short_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "click_tracking_links_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "broadcast_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "click_tracking_links_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      event_agent_config: {
        Row: {
          active: boolean
          agent_id: string | null
          created_at: string
          event_type: string
          id: string
          media_type: string | null
          media_url: string | null
          message_template: string | null
          send_media: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          agent_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          media_type?: string | null
          media_url?: string | null
          message_template?: string | null
          send_media?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          agent_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          media_type?: string | null
          media_url?: string | null
          message_template?: string | null
          send_media?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_agent_config_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_executions: {
        Row: {
          current_step_id: string | null
          flow_id: string
          id: string
          lead_id: string
          metadata: Json | null
          next_action_at: string | null
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          current_step_id?: string | null
          flow_id: string
          id?: string
          lead_id: string
          metadata?: Json | null
          next_action_at?: string | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          current_step_id?: string | null
          flow_id?: string
          id?: string
          lead_id?: string
          metadata?: Json | null
          next_action_at?: string | null
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_executions_current_step_id_fkey"
            columns: ["current_step_id"]
            isOneToOne: false
            referencedRelation: "flow_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_executions_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_steps: {
        Row: {
          ai_agent_id: string | null
          ai_match_description: string | null
          ai_prompt: string | null
          buttons: Json | null
          created_at: string
          custom_message: string | null
          delay_max_seconds: number | null
          delay_min_seconds: number | null
          delay_minutes: number | null
          file_name: string | null
          flow_id: string
          id: string
          is_entry: boolean
          label_ids: string[]
          match_mode: string
          max_interactions: number | null
          media_type: string | null
          media_url: string | null
          message_variations: Json
          no_response_conditions: Json
          parent_step_id: string | null
          step_order: number
          step_type: string
          template_id: string | null
          template_variations: Json
          timeout_minutes: number | null
          trigger_value: string | null
        }
        Insert: {
          ai_agent_id?: string | null
          ai_match_description?: string | null
          ai_prompt?: string | null
          buttons?: Json | null
          created_at?: string
          custom_message?: string | null
          delay_max_seconds?: number | null
          delay_min_seconds?: number | null
          delay_minutes?: number | null
          file_name?: string | null
          flow_id: string
          id?: string
          is_entry?: boolean
          label_ids?: string[]
          match_mode?: string
          max_interactions?: number | null
          media_type?: string | null
          media_url?: string | null
          message_variations?: Json
          no_response_conditions?: Json
          parent_step_id?: string | null
          step_order?: number
          step_type?: string
          template_id?: string | null
          template_variations?: Json
          timeout_minutes?: number | null
          trigger_value?: string | null
        }
        Update: {
          ai_agent_id?: string | null
          ai_match_description?: string | null
          ai_prompt?: string | null
          buttons?: Json | null
          created_at?: string
          custom_message?: string | null
          delay_max_seconds?: number | null
          delay_min_seconds?: number | null
          delay_minutes?: number | null
          file_name?: string | null
          flow_id?: string
          id?: string
          is_entry?: boolean
          label_ids?: string[]
          match_mode?: string
          max_interactions?: number | null
          media_type?: string | null
          media_url?: string | null
          message_variations?: Json
          no_response_conditions?: Json
          parent_step_id?: string | null
          step_order?: number
          step_type?: string
          template_id?: string | null
          template_variations?: Json
          timeout_minutes?: number | null
          trigger_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flow_steps_ai_agent_id_fkey"
            columns: ["ai_agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_steps_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_steps_parent_step_id_fkey"
            columns: ["parent_step_id"]
            isOneToOne: false
            referencedRelation: "flow_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_steps_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "chat_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      flows: {
        Row: {
          active: boolean
          auto_paused_by_system: boolean
          created_at: string
          delay_max_seconds: number
          delay_min_seconds: number
          description: string | null
          flow_kind: string
          id: string
          name: string
          position: number
          sending_window_enabled: boolean
          sending_window_end: string
          sending_window_start: string
          sending_window_timezone: string
          trigger_type: string | null
          updated_at: string
          user_id: string
          variation_enabled: boolean
        }
        Insert: {
          active?: boolean
          auto_paused_by_system?: boolean
          created_at?: string
          delay_max_seconds?: number
          delay_min_seconds?: number
          description?: string | null
          flow_kind?: string
          id?: string
          name: string
          position?: number
          sending_window_enabled?: boolean
          sending_window_end?: string
          sending_window_start?: string
          sending_window_timezone?: string
          trigger_type?: string | null
          updated_at?: string
          user_id: string
          variation_enabled?: boolean
        }
        Update: {
          active?: boolean
          auto_paused_by_system?: boolean
          created_at?: string
          delay_max_seconds?: number
          delay_min_seconds?: number
          description?: string | null
          flow_kind?: string
          id?: string
          name?: string
          position?: number
          sending_window_enabled?: boolean
          sending_window_end?: string
          sending_window_start?: string
          sending_window_timezone?: string
          trigger_type?: string | null
          updated_at?: string
          user_id?: string
          variation_enabled?: boolean
        }
        Relationships: []
      }
      instagram_automation_steps: {
        Row: {
          automation_id: string
          buttons: Json
          created_at: string
          delay_seconds: number | null
          dm_type: string
          id: string
          link_title: string | null
          link_url: string | null
          message: string | null
          step_order: number
          step_type: string
        }
        Insert: {
          automation_id: string
          buttons?: Json
          created_at?: string
          delay_seconds?: number | null
          dm_type?: string
          id?: string
          link_title?: string | null
          link_url?: string | null
          message?: string | null
          step_order?: number
          step_type?: string
        }
        Update: {
          automation_id?: string
          buttons?: Json
          created_at?: string
          delay_seconds?: number | null
          dm_type?: string
          id?: string
          link_title?: string | null
          link_url?: string | null
          message?: string | null
          step_order?: number
          step_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_automation_steps_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "instagram_automations"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_automations: {
        Row: {
          active: boolean
          created_at: string
          id: string
          keywords: string[]
          name: string
          trigger_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          keywords?: string[]
          name: string
          trigger_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          keywords?: string[]
          name?: string
          trigger_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      instagram_comment_automation_runs: {
        Row: {
          automation_id: string
          comment_id: string
          comment_text: string | null
          commenter_id: string | null
          commenter_username: string | null
          connection_id: string
          created_at: string
          error: string | null
          id: string
          media_id: string | null
          processed_at: string
          status: string
          step_results: Json
          user_id: string
        }
        Insert: {
          automation_id: string
          comment_id: string
          comment_text?: string | null
          commenter_id?: string | null
          commenter_username?: string | null
          connection_id: string
          created_at?: string
          error?: string | null
          id?: string
          media_id?: string | null
          processed_at?: string
          status?: string
          step_results?: Json
          user_id: string
        }
        Update: {
          automation_id?: string
          comment_id?: string
          comment_text?: string | null
          commenter_id?: string | null
          commenter_username?: string | null
          connection_id?: string
          created_at?: string
          error?: string | null
          id?: string
          media_id?: string | null
          processed_at?: string
          status?: string
          step_results?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_comment_automation_runs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "instagram_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_comment_automation_runs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "instagram_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_connections: {
        Row: {
          access_token: string
          created_at: string
          id: string
          instagram_user_id: string
          instagram_username: string | null
          page_id: string | null
          page_name: string | null
          status: string
          updated_at: string
          user_access_token: string | null
          user_id: string
          user_token_expires_at: string | null
        }
        Insert: {
          access_token: string
          created_at?: string
          id?: string
          instagram_user_id: string
          instagram_username?: string | null
          page_id?: string | null
          page_name?: string | null
          status?: string
          updated_at?: string
          user_access_token?: string | null
          user_id: string
          user_token_expires_at?: string | null
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          instagram_user_id?: string
          instagram_username?: string | null
          page_id?: string | null
          page_name?: string | null
          status?: string
          updated_at?: string
          user_access_token?: string | null
          user_id?: string
          user_token_expires_at?: string | null
        }
        Relationships: []
      }
      instagram_conversations: {
        Row: {
          connection_id: string
          created_at: string
          id: string
          ig_user_id: string
          last_message_at: string | null
          last_message_text: string | null
          participant_avatar_url: string | null
          participant_id: string
          participant_name: string | null
          participant_username: string | null
          unread_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          id?: string
          ig_user_id: string
          last_message_at?: string | null
          last_message_text?: string | null
          participant_avatar_url?: string | null
          participant_id: string
          participant_name?: string | null
          participant_username?: string | null
          unread_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          id?: string
          ig_user_id?: string
          last_message_at?: string | null
          last_message_text?: string | null
          participant_avatar_url?: string | null
          participant_id?: string
          participant_name?: string | null
          participant_username?: string | null
          unread_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      instagram_messages: {
        Row: {
          conversation_id: string
          created_at: string
          direction: string
          id: string
          ig_message_id: string | null
          media_type: string | null
          media_url: string | null
          status: string
          text: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          direction: string
          id?: string
          ig_message_id?: string | null
          media_type?: string | null
          media_url?: string | null
          status?: string
          text?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          direction?: string
          id?: string
          ig_message_id?: string | null
          media_type?: string | null
          media_url?: string | null
          status?: string
          text?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "instagram_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_webhook_events: {
        Row: {
          attempts: number
          connection_id: string | null
          entry_id: string | null
          error: string | null
          event_type: string
          id: string
          payload: Json
          processed: boolean
          processed_at: string | null
          received_at: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          connection_id?: string | null
          entry_id?: string | null
          error?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean
          processed_at?: string | null
          received_at?: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          connection_id?: string | null
          entry_id?: string | null
          error?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean
          processed_at?: string | null
          received_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      items: {
        Row: {
          created_at: string
          id: string
          name: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      lead_blacklist: {
        Row: {
          created_at: string
          flow_id: string | null
          id: string
          lead_id: string
          phone: string
          reason: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          flow_id?: string | null
          id?: string
          lead_id: string
          phone: string
          reason?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          flow_id?: string | null
          id?: string
          lead_id?: string
          phone?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      lead_distribution_settings: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          in_service_stage_id: string | null
          owner_id: string
          sticky_agent: boolean
          trigger_mode: string
          updated_at: string
          waiting_stage_id: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          in_service_stage_id?: string | null
          owner_id: string
          sticky_agent?: boolean
          trigger_mode?: string
          updated_at?: string
          waiting_stage_id?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          in_service_stage_id?: string | null
          owner_id?: string
          sticky_agent?: boolean
          trigger_mode?: string
          updated_at?: string
          waiting_stage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_distribution_settings_in_service_stage_id_fkey"
            columns: ["in_service_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_distribution_settings_waiting_stage_id_fkey"
            columns: ["waiting_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_distribution_targets: {
        Row: {
          active: boolean
          assigned_count: number
          created_at: string
          id: string
          last_assigned_at: string | null
          member_user_id: string
          owner_id: string
          updated_at: string
          weight_percent: number
        }
        Insert: {
          active?: boolean
          assigned_count?: number
          created_at?: string
          id?: string
          last_assigned_at?: string | null
          member_user_id: string
          owner_id: string
          updated_at?: string
          weight_percent?: number
        }
        Update: {
          active?: boolean
          assigned_count?: number
          created_at?: string
          id?: string
          last_assigned_at?: string | null
          member_user_id?: string
          owner_id?: string
          updated_at?: string
          weight_percent?: number
        }
        Relationships: []
      }
      lead_labels: {
        Row: {
          created_at: string
          id: string
          label_id: string
          lead_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label_id: string
          lead_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label_id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "chat_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_labels_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_send_dedup: {
        Row: {
          campaign_name: string | null
          created_at: string
          dedup_key: string
          id: string
          job_id: string | null
          lead_id: string | null
          phone: string
          template_name: string | null
          user_id: string
        }
        Insert: {
          campaign_name?: string | null
          created_at?: string
          dedup_key: string
          id?: string
          job_id?: string | null
          lead_id?: string | null
          phone: string
          template_name?: string | null
          user_id: string
        }
        Update: {
          campaign_name?: string | null
          created_at?: string
          dedup_key?: string
          id?: string
          job_id?: string | null
          lead_id?: string | null
          phone?: string
          template_name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          account_ids: string[]
          ai_agent_id: string | null
          ai_enabled: boolean
          assigned_to: string | null
          chat_status: string
          cpf: string | null
          created_at: string
          email: string | null
          hubla_id: string | null
          id: string
          last_assigned_to: string | null
          last_inbound_at: string | null
          last_message_account_id: string | null
          last_message_at: string | null
          last_message_content: string | null
          last_message_direction: string | null
          last_message_status: string | null
          last_outbound_at: string | null
          manually_unread: boolean
          metadata: Json
          name: string
          origin: string | null
          phone: string
          photo_url: string | null
          stage_id: string | null
          unsubscribe_reason: string | null
          unsubscribed: boolean
          unsubscribed_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_ids?: string[]
          ai_agent_id?: string | null
          ai_enabled?: boolean
          assigned_to?: string | null
          chat_status?: string
          cpf?: string | null
          created_at?: string
          email?: string | null
          hubla_id?: string | null
          id?: string
          last_assigned_to?: string | null
          last_inbound_at?: string | null
          last_message_account_id?: string | null
          last_message_at?: string | null
          last_message_content?: string | null
          last_message_direction?: string | null
          last_message_status?: string | null
          last_outbound_at?: string | null
          manually_unread?: boolean
          metadata?: Json
          name: string
          origin?: string | null
          phone: string
          photo_url?: string | null
          stage_id?: string | null
          unsubscribe_reason?: string | null
          unsubscribed?: boolean
          unsubscribed_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_ids?: string[]
          ai_agent_id?: string | null
          ai_enabled?: boolean
          assigned_to?: string | null
          chat_status?: string
          cpf?: string | null
          created_at?: string
          email?: string | null
          hubla_id?: string | null
          id?: string
          last_assigned_to?: string | null
          last_inbound_at?: string | null
          last_message_account_id?: string | null
          last_message_at?: string | null
          last_message_content?: string | null
          last_message_direction?: string | null
          last_message_status?: string | null
          last_outbound_at?: string | null
          manually_unread?: boolean
          metadata?: Json
          name?: string
          origin?: string | null
          phone?: string
          photo_url?: string | null
          stage_id?: string | null
          unsubscribe_reason?: string | null
          unsubscribed?: boolean
          unsubscribed_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_ai_agent_id_fkey"
            columns: ["ai_agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_logs: {
        Row: {
          account_id: string | null
          block_severity: string | null
          created_at: string
          delivered_at: string | null
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          id: string
          job_id: string
          lead_id: string | null
          meta_error_code: string | null
          meta_error_details: string | null
          meta_error_title: string | null
          phone: string
          read_at: string | null
          sent_at: string | null
          status: string
          user_id: string
          wa_message_id: string | null
        }
        Insert: {
          account_id?: string | null
          block_severity?: string | null
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          job_id: string
          lead_id?: string | null
          meta_error_code?: string | null
          meta_error_details?: string | null
          meta_error_title?: string | null
          phone: string
          read_at?: string | null
          sent_at?: string | null
          status?: string
          user_id: string
          wa_message_id?: string | null
        }
        Update: {
          account_id?: string | null
          block_severity?: string | null
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          job_id?: string
          lead_id?: string | null
          meta_error_code?: string | null
          meta_error_details?: string | null
          meta_error_title?: string | null
          phone?: string
          read_at?: string | null
          sent_at?: string | null
          status?: string
          user_id?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "broadcast_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_connections: {
        Row: {
          created_at: string
          id: string
          meta_access_token: string
          phone_number: string | null
          phone_number_id: string | null
          status: string
          updated_at: string
          user_id: string
          waba_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          meta_access_token: string
          phone_number?: string | null
          phone_number_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
          waba_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          meta_access_token?: string
          phone_number?: string | null
          phone_number_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          waba_id?: string | null
        }
        Relationships: []
      }
      metrito_settings: {
        Row: {
          api_key: string | null
          created_at: string
          generic_key: string | null
          id: string
          owner_id: string
          project_id: string | null
          updated_at: string
        }
        Insert: {
          api_key?: string | null
          created_at?: string
          generic_key?: string | null
          id?: string
          owner_id: string
          project_id?: string | null
          updated_at?: string
        }
        Update: {
          api_key?: string | null
          created_at?: string
          generic_key?: string | null
          id?: string
          owner_id?: string
          project_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notification_prefs: {
        Row: {
          assigned_to_me: boolean
          created_at: string
          new_lead: boolean
          new_message: boolean
          sound: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_to_me?: boolean
          created_at?: string
          new_lead?: boolean
          new_message?: boolean
          sound?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_to_me?: boolean
          created_at?: string
          new_lead?: boolean
          new_message?: boolean
          sound?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          lead_id: string | null
          link: string | null
          message: string | null
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id?: string | null
          link?: string | null
          message?: string | null
          read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string | null
          link?: string | null
          message?: string | null
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          id: string
          item_id: string
          order_id: string
          quantity: number
          user_id: string | null
        }
        Insert: {
          id?: string
          item_id: string
          order_id: string
          quantity?: number
          user_id?: string | null
        }
        Update: {
          id?: string
          item_id?: string
          order_id?: string
          quantity?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          amount: number
          created_at: string
          external_order_id: string
          id: string
          lead_id: string
          payment_method: string | null
          product_id: string | null
          status: string
          updated_at: string
          user_id: string | null
          webhook_payload: Json | null
        }
        Insert: {
          amount?: number
          created_at?: string
          external_order_id: string
          id?: string
          lead_id: string
          payment_method?: string | null
          product_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          webhook_payload?: Json | null
        }
        Update: {
          amount?: number
          created_at?: string
          external_order_id?: string
          id?: string
          lead_id?: string
          payment_method?: string | null
          product_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          webhook_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          owner_id: string
          position: number
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          owner_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: []
      }
      product_items: {
        Row: {
          id: string
          item_id: string
          product_id: string
          quantity: number
          user_id: string | null
        }
        Insert: {
          id?: string
          item_id: string
          product_id: string
          quantity?: number
          user_id?: string | null
        }
        Update: {
          id?: string
          item_id?: string
          product_id?: string
          quantity?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          checkout_name: string
          created_at: string
          id: string
          price: number | null
          sku: string | null
          user_id: string | null
        }
        Insert: {
          active?: boolean
          checkout_name: string
          created_at?: string
          id?: string
          price?: number | null
          sku?: string | null
          user_id?: string | null
        }
        Update: {
          active?: boolean
          checkout_name?: string
          created_at?: string
          id?: string
          price?: number | null
          sku?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          home_view: string
          id: string
          instagram_enabled: boolean
          trial_ends_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          home_view?: string
          id?: string
          instagram_enabled?: boolean
          trial_ends_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          home_view?: string
          id?: string
          instagram_enabled?: boolean
          trial_ends_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      share_links: {
        Row: {
          account_id: string | null
          active: boolean
          click_count: number
          created_at: string
          id: string
          label_id: string | null
          message: string
          name: string
          phone: string
          stage_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          active?: boolean
          click_count?: number
          created_at?: string
          id?: string
          label_id?: string | null
          message?: string
          name: string
          phone: string
          stage_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          active?: boolean
          click_count?: number
          created_at?: string
          id?: string
          label_id?: string | null
          message?: string
          name?: string
          phone?: string
          stage_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "share_links_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_links_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "chat_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_links_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_automations: {
        Row: {
          active: boolean
          created_at: string
          from_stage_id: string | null
          id: string
          keywords: string[]
          name: string
          to_stage_id: string
          trigger_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          from_stage_id?: string | null
          id?: string
          keywords?: string[]
          name: string
          to_stage_id: string
          trigger_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          from_stage_id?: string | null
          id?: string
          keywords?: string[]
          name?: string
          to_stage_id?: string
          trigger_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stage_automations_from_stage_id_fkey"
            columns: ["from_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_automations_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          access_level: string
          created_at: string
          id: string
          lead_scope: string
          member_user_id: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          access_level?: string
          created_at?: string
          id?: string
          lead_scope?: string
          member_user_id: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          access_level?: string
          created_at?: string
          id?: string
          lead_scope?: string
          member_user_id?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      template_spam_analysis: {
        Row: {
          analyzed_at: string
          content_snapshot: string | null
          created_at: string
          id: string
          risk_level: string
          spam_score: number
          template_id: string
          updated_at: string
          user_id: string
          warnings: Json
        }
        Insert: {
          analyzed_at?: string
          content_snapshot?: string | null
          created_at?: string
          id?: string
          risk_level?: string
          spam_score?: number
          template_id: string
          updated_at?: string
          user_id: string
          warnings?: Json
        }
        Update: {
          analyzed_at?: string
          content_snapshot?: string | null
          created_at?: string
          id?: string
          risk_level?: string
          spam_score?: number
          template_id?: string
          updated_at?: string
          user_id?: string
          warnings?: Json
        }
        Relationships: []
      }
      unsubscribe_logs: {
        Row: {
          account_id: string | null
          created_at: string
          id: string
          keyword_matched: string | null
          lead_id: string | null
          phone: string
          source: string
          source_message: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          id?: string
          keyword_matched?: string | null
          lead_id?: string | null
          phone: string
          source?: string
          source_message?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          id?: string
          keyword_matched?: string | null
          lead_id?: string | null
          phone?: string
          source?: string
          source_message?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_plan_limits: {
        Row: {
          created_at: string
          id: string
          last_reset_at: string
          max_concurrent_campaigns: number
          max_contacts_per_campaign: number
          max_messages_per_day: number
          messages_sent_today: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_reset_at?: string
          max_concurrent_campaigns?: number
          max_contacts_per_campaign?: number
          max_messages_per_day?: number
          messages_sent_today?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_reset_at?: string
          max_concurrent_campaigns?: number
          max_contacts_per_campaign?: number
          max_messages_per_day?: number
          messages_sent_today?: number
          updated_at?: string
          user_id?: string
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
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      waba_health_events: {
        Row: {
          account_id: string
          created_at: string
          event_code: string
          event_message: string | null
          event_title: string
          id: string
          meta_error_code: string | null
          metadata: Json
          resolved_at: string | null
          severity: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          event_code: string
          event_message?: string | null
          event_title: string
          id?: string
          meta_error_code?: string | null
          metadata?: Json
          resolved_at?: string | null
          severity?: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          event_code?: string
          event_message?: string | null
          event_title?: string
          id?: string
          meta_error_code?: string | null
          metadata?: Json
          resolved_at?: string | null
          severity?: string
          user_id?: string
        }
        Relationships: []
      }
      waba_health_snapshots: {
        Row: {
          account_id: string
          block_rate_24h: number | null
          captured_at: string
          delivery_rate_24h: number | null
          id: string
          messaging_limit: number | null
          messaging_tier: string | null
          quality_rating: string | null
          raw: Json
          reputation_score: number | null
          user_id: string
        }
        Insert: {
          account_id: string
          block_rate_24h?: number | null
          captured_at?: string
          delivery_rate_24h?: number | null
          id?: string
          messaging_limit?: number | null
          messaging_tier?: string | null
          quality_rating?: string | null
          raw?: Json
          reputation_score?: number | null
          user_id: string
        }
        Update: {
          account_id?: string
          block_rate_24h?: number | null
          captured_at?: string
          delivery_rate_24h?: number | null
          id?: string
          messaging_limit?: number | null
          messaging_tier?: string | null
          quality_rating?: string | null
          raw?: Json
          reputation_score?: number | null
          user_id?: string
        }
        Relationships: []
      }
      webhook_debug: {
        Row: {
          created_at: string
          headers: Json | null
          id: string
          notes: string | null
          parsed: Json | null
          raw_body: string | null
          source: string
        }
        Insert: {
          created_at?: string
          headers?: Json | null
          id?: string
          notes?: string | null
          parsed?: Json | null
          raw_body?: string | null
          source?: string
        }
        Update: {
          created_at?: string
          headers?: Json | null
          id?: string
          notes?: string | null
          parsed?: Json | null
          raw_body?: string | null
          source?: string
        }
        Relationships: []
      }
      webhook_endpoints: {
        Row: {
          account_id: string | null
          created_at: string
          event_type: string
          field_mapping: Json
          id: string
          is_active: boolean
          updated_at: string
          user_id: string
          webhook_token: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          event_type: string
          field_mapping?: Json
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id: string
          webhook_token?: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          event_type?: string
          field_mapping?: Json
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id?: string
          webhook_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          created_at: string
          endpoint_id: string
          event_type: string
          id: string
          is_test: boolean
          payload: Json | null
          processed: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint_id: string
          event_type: string
          id?: string
          is_test?: boolean
          payload?: Json | null
          processed?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint_id?: string
          event_type?: string
          id?: string
          is_test?: boolean
          payload?: Json | null
          processed?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_logs: {
        Row: {
          created_at: string
          event_status: string | null
          external_order_id: string | null
          http_status: number
          id: string
          payload: Json | null
          response_message: string | null
        }
        Insert: {
          created_at?: string
          event_status?: string | null
          external_order_id?: string | null
          http_status?: number
          id?: string
          payload?: Json | null
          response_message?: string | null
        }
        Update: {
          created_at?: string
          event_status?: string | null
          external_order_id?: string | null
          http_status?: number
          id?: string
          payload?: Json | null
          response_message?: string | null
        }
        Relationships: []
      }
      whatsapp_account_audit: {
        Row: {
          account_id: string | null
          created_at: string
          details: Json
          event: string
          id: string
          status: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          details?: Json
          event: string
          id?: string
          status: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          details?: Json
          event?: string
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_account_audit_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_accounts: {
        Row: {
          access_token: string
          api_key: string | null
          app_id: string | null
          business_account_id: string | null
          business_id: string | null
          created_at: string
          display_phone_number: string | null
          id: string
          is_default: boolean
          last_health_at: string | null
          last_health_status: string | null
          meta_user_id: string | null
          name: string
          onboarding_method: string | null
          phone_number_id: string
          provider: string
          provisioned_at: string | null
          token_app_id: string | null
          token_checked_at: string | null
          token_type: string | null
          token_validity: string
          updated_at: string
          user_id: string | null
          webhook_last_check_at: string | null
          webhook_last_status: string | null
          webhook_subscribed: boolean
          webhook_subscribed_at: string | null
        }
        Insert: {
          access_token: string
          api_key?: string | null
          app_id?: string | null
          business_account_id?: string | null
          business_id?: string | null
          created_at?: string
          display_phone_number?: string | null
          id?: string
          is_default?: boolean
          last_health_at?: string | null
          last_health_status?: string | null
          meta_user_id?: string | null
          name: string
          onboarding_method?: string | null
          phone_number_id: string
          provider?: string
          provisioned_at?: string | null
          token_app_id?: string | null
          token_checked_at?: string | null
          token_type?: string | null
          token_validity?: string
          updated_at?: string
          user_id?: string | null
          webhook_last_check_at?: string | null
          webhook_last_status?: string | null
          webhook_subscribed?: boolean
          webhook_subscribed_at?: string | null
        }
        Update: {
          access_token?: string
          api_key?: string | null
          app_id?: string | null
          business_account_id?: string | null
          business_id?: string | null
          created_at?: string
          display_phone_number?: string | null
          id?: string
          is_default?: boolean
          last_health_at?: string | null
          last_health_status?: string | null
          meta_user_id?: string | null
          name?: string
          onboarding_method?: string | null
          phone_number_id?: string
          provider?: string
          provisioned_at?: string | null
          token_app_id?: string | null
          token_checked_at?: string | null
          token_type?: string | null
          token_validity?: string
          updated_at?: string
          user_id?: string | null
          webhook_last_check_at?: string | null
          webhook_last_status?: string | null
          webhook_subscribed?: boolean
          webhook_subscribed_at?: string | null
        }
        Relationships: []
      }
      whatsapp_audit_log: {
        Row: {
          account_id: string | null
          created_at: string
          details: Json
          event: string
          flags: string[]
          id: string
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          details?: Json
          event: string
          flags?: string[]
          id?: string
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          details?: Json
          event?: string
          flags?: string[]
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      whatsapp_dead_letter: {
        Row: {
          created_at: string
          display_phone_number: string | null
          id: string
          payload: Json
          phone_number_id: string | null
          reason: string
          waba_id: string | null
        }
        Insert: {
          created_at?: string
          display_phone_number?: string | null
          id?: string
          payload?: Json
          phone_number_id?: string | null
          reason: string
          waba_id?: string | null
        }
        Update: {
          created_at?: string
          display_phone_number?: string | null
          id?: string
          payload?: Json
          phone_number_id?: string | null
          reason?: string
          waba_id?: string | null
        }
        Relationships: []
      }
      whatsapp_inbound_dedup: {
        Row: {
          created_at: string
          message_id: string
        }
        Insert: {
          created_at?: string
          message_id: string
        }
        Update: {
          created_at?: string
          message_id?: string
        }
        Relationships: []
      }
      whatsapp_onboarding_sessions: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          metadata: Json
          state: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          state: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          state?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      distribute_lead: { Args: { p_lead_id: string }; Returns: string }
      get_advanced_dashboard_stats: {
        Args: { p_user_id: string }
        Returns: {
          active_flows: number
          avg_response_time_minutes: number
          response_rate: number
          total_campaigns: number
          total_delivered: number
          total_errors: number
          total_leads: number
          total_messages_sent: number
          total_read: number
        }[]
      }
      get_dashboard_stats: {
        Args: never
        Returns: {
          approved_revenue: number
          expiring_soon_count: number
          total_leads: number
          total_orders: number
          total_products: number
        }[]
      }
      get_sales_summary: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          approved_revenue: number
          by_product: Json
          returning_buyers: number
          total_buyers: number
          total_orders: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      list_buyers: {
        Args: {
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_to?: string
        }
        Returns: {
          created_at: string
          email: string
          hubla_id: string
          id: string
          name: string
          phone: string
          purchase_count: number
          top_products: string[]
          total_count: number
        }[]
      }
      notify_lead_event: {
        Args: {
          p_lead_id: string
          p_message: string
          p_title: string
          p_type: string
          p_user_id: string
        }
        Returns: undefined
      }
      order_net_amount: {
        Args: { p_amount: number; p_payload: Json }
        Returns: number
      }
      recover_stuck_flow_executions: { Args: never; Returns: number }
      search_orders: {
        Args: {
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_statuses?: string[]
          p_to?: string
        }
        Returns: {
          amount: number
          created_at: string
          external_order_id: string
          id: string
          lead_email: string
          lead_id: string
          lead_name: string
          lead_phone: string
          net_amount: number
          payment_method: string
          product_id: string
          product_name: string
          status: string
          total_count: number
          updated_at: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      team_access_level: { Args: { _owner: string }; Returns: string }
      team_lead_scope: { Args: { _owner: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
