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
      broadcast_jobs: {
        Row: {
          account_id: string
          created_at: string
          delivered_count: number
          error_count: number
          id: string
          last_cursor: number
          last_error: string | null
          lead_ids: string[]
          read_count: number
          retry_map: Json | null
          sent_count: number
          status: string
          template_id: string | null
          template_language: string | null
          template_name: string | null
          template_params: Json | null
          total_leads: number
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          delivered_count?: number
          error_count?: number
          id?: string
          last_cursor?: number
          last_error?: string | null
          lead_ids?: string[]
          read_count?: number
          retry_map?: Json | null
          sent_count?: number
          status?: string
          template_id?: string | null
          template_language?: string | null
          template_name?: string | null
          template_params?: Json | null
          total_leads?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          delivered_count?: number
          error_count?: number
          id?: string
          last_cursor?: number
          last_error?: string | null
          lead_ids?: string[]
          read_count?: number
          retry_map?: Json | null
          sent_count?: number
          status?: string
          template_id?: string | null
          template_language?: string | null
          template_name?: string | null
          template_params?: Json | null
          total_leads?: number
          updated_at?: string
          user_id?: string
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
        }
        Relationships: []
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
          buttons: Json | null
          created_at: string
          custom_message: string | null
          delay_minutes: number | null
          flow_id: string
          id: string
          parent_step_id: string | null
          step_order: number
          step_type: string
          template_id: string | null
          timeout_minutes: number | null
          trigger_value: string | null
        }
        Insert: {
          buttons?: Json | null
          created_at?: string
          custom_message?: string | null
          delay_minutes?: number | null
          flow_id: string
          id?: string
          parent_step_id?: string | null
          step_order?: number
          step_type?: string
          template_id?: string | null
          timeout_minutes?: number | null
          trigger_value?: string | null
        }
        Update: {
          buttons?: Json | null
          created_at?: string
          custom_message?: string | null
          delay_minutes?: number | null
          flow_id?: string
          id?: string
          parent_step_id?: string | null
          step_order?: number
          step_type?: string
          template_id?: string | null
          timeout_minutes?: number | null
          trigger_value?: string | null
        }
        Relationships: [
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
          description: string | null
          id: string
          name: string
          trigger_type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
          trigger_type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          trigger_type?: string | null
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
          user_id: string
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
          user_id: string
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
          user_id?: string
        }
        Relationships: []
      }
      items: {
        Row: {
          created_at: string
          id: string
          name: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          type?: string
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
        }
        Insert: {
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
        }
        Update: {
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
        }
        Relationships: []
      }
      meta_connections: {
        Row: {
          created_at: string
          id: string
          meta_access_token: string
          phone_number: string
          phone_number_id: string
          status: string
          updated_at: string
          user_id: string
          waba_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          meta_access_token: string
          phone_number: string
          phone_number_id: string
          status?: string
          updated_at?: string
          user_id: string
          waba_id: string
        }
        Update: {
          created_at?: string
          id?: string
          meta_access_token?: string
          phone_number?: string
          phone_number_id?: string
          status?: string
          updated_at?: string
          user_id?: string
          waba_id?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          id: string
          item_id: string
          order_id: string
          quantity: number
        }
        Insert: {
          id?: string
          item_id: string
          order_id: string
          quantity?: number
        }
        Update: {
          id?: string
          item_id?: string
          order_id?: string
          quantity?: number
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
        }
        Insert: {
          id?: string
          item_id: string
          product_id: string
          quantity?: number
        }
        Update: {
          id?: string
          item_id?: string
          product_id?: string
          quantity?: number
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
        }
        Insert: {
          active?: boolean
          checkout_name: string
          created_at?: string
          id?: string
          price?: number | null
          sku?: string | null
        }
        Update: {
          active?: boolean
          checkout_name?: string
          created_at?: string
          id?: string
          price?: number | null
          sku?: string | null
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
      webhook_endpoints: {
        Row: {
          created_at: string
          event_type: string
          id: string
          is_active: boolean
          updated_at: string
          user_id: string
          webhook_token: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id: string
          webhook_token?: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id?: string
          webhook_token?: string
        }
        Relationships: []
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
          business_account_id: string | null
          created_at: string
          id: string
          is_default: boolean
          name: string
          phone_number_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_token: string
          business_account_id?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          phone_number_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_token?: string
          business_account_id?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          phone_number_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
