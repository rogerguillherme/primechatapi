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
    PostgrestVersion: "14.1"
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
      chat_labels: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          account_id: string | null
          content: string
          created_at: string
          delivered_at: string | null
          direction: string
          id: string
          lead_id: string
          media_type: string | null
          media_url: string | null
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
          id?: string
          lead_id: string
          media_type?: string | null
          media_url?: string | null
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
          id?: string
          lead_id?: string
          media_type?: string | null
          media_url?: string | null
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
      chat_templates: {
        Row: {
          category: string | null
          content: string
          created_at: string
          id: string
          meta_status: string | null
          name: string
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
          max_interactions: number | null
          media_type: string | null
          media_url: string | null
          message_variations: Json
          parent_step_id: string | null
          step_order: number
          step_type: string
          template_id: string | null
          timeout_minutes: number | null
          trigger_value: string | null
        }
        Insert: {
          ai_agent_id?: string | null
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
          max_interactions?: number | null
          media_type?: string | null
          media_url?: string | null
          message_variations?: Json
          parent_step_id?: string | null
          step_order?: number
          step_type?: string
          template_id?: string | null
          timeout_minutes?: number | null
          trigger_value?: string | null
        }
        Update: {
          ai_agent_id?: string | null
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
          max_interactions?: number | null
          media_type?: string | null
          media_url?: string | null
          message_variations?: Json
          parent_step_id?: string | null
          step_order?: number
          step_type?: string
          template_id?: string | null
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
          created_at: string
          delay_max_seconds: number
          delay_min_seconds: number
          description: string | null
          flow_kind: string
          id: string
          name: string
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
          created_at?: string
          delay_max_seconds?: number
          delay_min_seconds?: number
          description?: string | null
          flow_kind?: string
          id?: string
          name: string
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
          created_at?: string
          delay_max_seconds?: number
          delay_min_seconds?: number
          description?: string | null
          flow_kind?: string
          id?: string
          name?: string
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
      leads: {
        Row: {
          ai_agent_id: string | null
          ai_enabled: boolean
          assigned_to: string | null
          chat_status: string
          cpf: string | null
          created_at: string
          email: string | null
          hubla_id: string | null
          id: string
          last_inbound_at: string | null
          last_outbound_at: string | null
          name: string
          origin: string | null
          phone: string
          photo_url: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          ai_agent_id?: string | null
          ai_enabled?: boolean
          assigned_to?: string | null
          chat_status?: string
          cpf?: string | null
          created_at?: string
          email?: string | null
          hubla_id?: string | null
          id?: string
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          name: string
          origin?: string | null
          phone: string
          photo_url?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          ai_agent_id?: string | null
          ai_enabled?: boolean
          assigned_to?: string | null
          chat_status?: string
          cpf?: string | null
          created_at?: string
          email?: string | null
          hubla_id?: string | null
          id?: string
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          name?: string
          origin?: string | null
          phone?: string
          photo_url?: string | null
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
        ]
      }
      message_logs: {
        Row: {
          account_id: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          job_id: string
          lead_id: string | null
          phone: string
          sent_at: string | null
          status: string
          user_id: string
          wa_message_id: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          job_id: string
          lead_id?: string | null
          phone: string
          sent_at?: string | null
          status?: string
          user_id: string
          wa_message_id?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          job_id?: string
          lead_id?: string | null
          phone?: string
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
      notifications: {
        Row: {
          created_at: string
          id: string
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
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
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
      whatsapp_accounts: {
        Row: {
          access_token: string
          api_key: string | null
          app_id: string | null
          business_account_id: string | null
          business_id: string | null
          created_at: string
          id: string
          is_default: boolean
          last_health_at: string | null
          last_health_status: string | null
          name: string
          onboarding_method: string | null
          phone_number_id: string
          provider: string
          provisioned_at: string | null
          token_type: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_token: string
          api_key?: string | null
          app_id?: string | null
          business_account_id?: string | null
          business_id?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          last_health_at?: string | null
          last_health_status?: string | null
          name: string
          onboarding_method?: string | null
          phone_number_id: string
          provider?: string
          provisioned_at?: string | null
          token_type?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_token?: string
          api_key?: string | null
          app_id?: string | null
          business_account_id?: string | null
          business_id?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          last_health_at?: string | null
          last_health_status?: string | null
          name?: string
          onboarding_method?: string | null
          phone_number_id?: string
          provider?: string
          provisioned_at?: string | null
          token_type?: string | null
          updated_at?: string
          user_id?: string | null
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
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
