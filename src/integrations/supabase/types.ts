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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      api_keys: {
        Row: {
          account_id: string | null
          created_at: string
          id: string
          is_master: boolean
          key_hash: string
          key_prefix: string
          label: string
          last_used_at: string | null
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          id?: string
          is_master?: boolean
          key_hash: string
          key_prefix: string
          label: string
          last_used_at?: string | null
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          id?: string
          is_master?: boolean
          key_hash?: string
          key_prefix?: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "wa_accounts"
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
      broadcast_recipients: {
        Row: {
          broadcast_id: string
          contact_id: string
          error: string | null
          id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["recipient_status"]
        }
        Insert: {
          broadcast_id: string
          contact_id: string
          error?: string | null
          id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["recipient_status"]
        }
        Update: {
          broadcast_id?: string
          contact_id?: string
          error?: string | null
          id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["recipient_status"]
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcasts: {
        Row: {
          account_id: string
          body: string
          created_at: string
          created_by: string | null
          id: string
          media_url: string | null
          name: string
          scheduled_at: string | null
          status: Database["public"]["Enums"]["broadcast_status"]
          throttle_per_min: number
          updated_at: string
        }
        Insert: {
          account_id: string
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          media_url?: string | null
          name: string
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["broadcast_status"]
          throttle_per_min?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          media_url?: string | null
          name?: string
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["broadcast_status"]
          throttle_per_min?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcasts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "wa_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_tags: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          tag: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          tag: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          account_id: string
          created_at: string
          display_name: string | null
          id: string
          notes: string | null
          phone: string | null
          pipeline_stage: Database["public"]["Enums"]["pipeline_stage"]
          updated_at: string
          wa_jid: string
        }
        Insert: {
          account_id: string
          created_at?: string
          display_name?: string | null
          id?: string
          notes?: string | null
          phone?: string | null
          pipeline_stage?: Database["public"]["Enums"]["pipeline_stage"]
          updated_at?: string
          wa_jid: string
        }
        Update: {
          account_id?: string
          created_at?: string
          display_name?: string | null
          id?: string
          notes?: string | null
          phone?: string | null
          pipeline_stage?: Database["public"]["Enums"]["pipeline_stage"]
          updated_at?: string
          wa_jid?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "wa_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          account_id: string
          assigned_agent_id: string | null
          contact_id: string
          created_at: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          account_id: string
          assigned_agent_id?: string | null
          contact_id: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          assigned_agent_id?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "wa_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string | null
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["msg_direction"]
          id: string
          media_url: string | null
          sent_by_ai: boolean
          sent_by_user_id: string | null
          status: Database["public"]["Enums"]["msg_status"]
          type: Database["public"]["Enums"]["msg_type"]
          wa_message_id: string | null
        }
        Insert: {
          body?: string | null
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["msg_direction"]
          id?: string
          media_url?: string | null
          sent_by_ai?: boolean
          sent_by_user_id?: string | null
          status?: Database["public"]["Enums"]["msg_status"]
          type?: Database["public"]["Enums"]["msg_type"]
          wa_message_id?: string | null
        }
        Update: {
          body?: string | null
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["msg_direction"]
          id?: string
          media_url?: string | null
          sent_by_ai?: boolean
          sent_by_user_id?: string | null
          status?: Database["public"]["Enums"]["msg_status"]
          type?: Database["public"]["Enums"]["msg_type"]
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      reply_rules: {
        Row: {
          account_id: string
          created_at: string
          enabled: boolean
          id: string
          name: string
          pattern: string
          priority: number
          response_template: string
          trigger_type: Database["public"]["Enums"]["rule_trigger"]
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          pattern: string
          priority?: number
          response_template: string
          trigger_type?: Database["public"]["Enums"]["rule_trigger"]
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          pattern?: string
          priority?: number
          response_template?: string
          trigger_type?: Database["public"]["Enums"]["rule_trigger"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reply_rules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "wa_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wa_account_agents: {
        Row: {
          account_id: string
          agent_user_id: string
          created_at: string
        }
        Insert: {
          account_id: string
          agent_user_id: string
          created_at?: string
        }
        Update: {
          account_id?: string
          agent_user_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_account_agents_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "wa_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_accounts: {
        Row: {
          ai_enabled: boolean
          ai_prompt: string | null
          auto_reply_enabled: boolean
          business_hours: Json | null
          created_at: string
          created_by: string | null
          id: string
          label: string
          last_qr: string | null
          last_qr_at: string | null
          phone: string | null
          status: Database["public"]["Enums"]["wa_account_status"]
          throttle_per_min: number
          updated_at: string
        }
        Insert: {
          ai_enabled?: boolean
          ai_prompt?: string | null
          auto_reply_enabled?: boolean
          business_hours?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          last_qr?: string | null
          last_qr_at?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["wa_account_status"]
          throttle_per_min?: number
          updated_at?: string
        }
        Update: {
          ai_enabled?: boolean
          ai_prompt?: string | null
          auto_reply_enabled?: boolean
          business_hours?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          last_qr?: string | null
          last_qr_at?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["wa_account_status"]
          throttle_per_min?: number
          updated_at?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          created_at: string
          error: string | null
          id: string
          kind: string
          payload: Json
          processed_at: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          payload: Json
          processed_at?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          payload?: Json
          processed_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      app_role: "admin" | "agent"
      broadcast_status:
        | "draft"
        | "scheduled"
        | "running"
        | "completed"
        | "failed"
        | "canceled"
      msg_direction: "in" | "out"
      msg_status: "pending" | "sent" | "delivered" | "read" | "failed"
      msg_type:
        | "text"
        | "image"
        | "audio"
        | "video"
        | "document"
        | "sticker"
        | "location"
        | "contact"
        | "system"
      pipeline_stage: "new" | "qualified" | "customer" | "lost"
      recipient_status: "pending" | "sent" | "delivered" | "failed"
      rule_trigger: "keyword" | "regex" | "any"
      wa_account_status:
        | "disconnected"
        | "connecting"
        | "connected"
        | "banned"
        | "error"
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
      app_role: ["admin", "agent"],
      broadcast_status: [
        "draft",
        "scheduled",
        "running",
        "completed",
        "failed",
        "canceled",
      ],
      msg_direction: ["in", "out"],
      msg_status: ["pending", "sent", "delivered", "read", "failed"],
      msg_type: [
        "text",
        "image",
        "audio",
        "video",
        "document",
        "sticker",
        "location",
        "contact",
        "system",
      ],
      pipeline_stage: ["new", "qualified", "customer", "lost"],
      recipient_status: ["pending", "sent", "delivered", "failed"],
      rule_trigger: ["keyword", "regex", "any"],
      wa_account_status: [
        "disconnected",
        "connecting",
        "connected",
        "banned",
        "error",
      ],
    },
  },
} as const
