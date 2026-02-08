export type Database = {
  public: {
    Tables: {
      billing_accounts: {
        Row: {
          user_id: string
          balance_pln_grosze: number | string | null
          balance_usd_cents: number | string | null
          total_paid_pln: number | string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          user_id: string
          balance_pln_grosze?: number | string | null
          balance_usd_cents?: number | string | null
          total_paid_pln?: number | string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          user_id?: string
          balance_pln_grosze?: number | string | null
          balance_usd_cents?: number | string | null
          total_paid_pln?: number | string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      billing_balance_adjustments: {
        Row: {
          id: string
          admin_user_id: string
          target_user_id: string
          delta_pln: number | string
          balance_before: number | string
          balance_after: number | string
          delta_minor: number | string | null
          balance_before_minor: number | string | null
          balance_after_minor: number | string | null
          currency: string | null
          created_at: string
          note: string | null
          request_id: string | null
        }
        Insert: {
          id?: string
          admin_user_id: string
          target_user_id: string
          delta_pln: number | string
          balance_before: number | string
          balance_after: number | string
          delta_minor?: number | string | null
          balance_before_minor?: number | string | null
          balance_after_minor?: number | string | null
          currency?: string | null
          created_at?: string
          note?: string | null
          request_id?: string | null
        }
        Update: {
          id?: string
          admin_user_id?: string
          target_user_id?: string
          delta_pln?: number | string
          balance_before?: number | string
          balance_after?: number | string
          delta_minor?: number | string | null
          balance_before_minor?: number | string | null
          balance_after_minor?: number | string | null
          currency?: string | null
          created_at?: string
          note?: string | null
          request_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          billing_currency: string | null
          locale: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          billing_currency?: string | null
          locale?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          billing_currency?: string | null
          locale?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sessions: {
        Row: {
          id: string
          user_id: string
          name: string
          created_at: string | number
          updated_at: string | number
          last_group_code: string | null
          last_mode_code: number | null
          last_category_code: string | null
          stuck_counter: number | null
          tokens_in_total: number | null
          tokens_out_total: number | null
        }
        Insert: {
          id: string
          user_id: string
          name: string
          created_at?: string | number
          updated_at?: string | number
          last_group_code?: string | null
          last_mode_code?: number | null
          last_category_code?: string | null
          stuck_counter?: number | null
          tokens_in_total?: number | null
          tokens_out_total?: number | null
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          created_at?: string | number
          updated_at?: string | number
          last_group_code?: string | null
          last_mode_code?: number | null
          last_category_code?: string | null
          stuck_counter?: number | null
          tokens_in_total?: number | null
          tokens_out_total?: number | null
        }
        Relationships: []
      }
      board_items: {
        Row: {
          id: string
          user_id: string
          session_id: string
          type: string
          text: string
          label: string | null
          question_id: string | null
          question_text_pl: string | null
          question_text_en: string | null
          created_at: number | string
          entry_type: string | null
          prompt_type: string | null
          matrix_row: string | null
          matrix_col: string | null
          last_classified_text: string | null
          classification_dirty: boolean | null
        }
        Insert: {
          id?: string
          user_id: string
          session_id: string
          type?: string
          text: string
          label?: string | null
          question_id?: string | null
          question_text_pl?: string | null
          question_text_en?: string | null
          created_at?: number | string
          entry_type?: string | null
          prompt_type?: string | null
          matrix_row?: string | null
          matrix_col?: string | null
          last_classified_text?: string | null
          classification_dirty?: boolean | null
        }
        Update: {
          id?: string
          user_id?: string
          session_id?: string
          type?: string
          text?: string
          label?: string | null
          question_id?: string | null
          question_text_pl?: string | null
          question_text_en?: string | null
          created_at?: number | string
          entry_type?: string | null
          prompt_type?: string | null
          matrix_row?: string | null
          matrix_col?: string | null
          last_classified_text?: string | null
          classification_dirty?: boolean | null
        }
        Relationships: []
      }
      reports: {
        Row: {
          id: string
          session_id: string
          created_at: string
          updated_at: string
          summary_json: unknown | null
          last_summary_text_hash: string | null
          source_updated_at: number | string | null
        }
        Insert: {
          id?: string
          session_id: string
          created_at?: string
          updated_at?: string
          summary_json?: unknown | null
          last_summary_text_hash?: string | null
          source_updated_at?: number | string | null
        }
        Update: {
          id?: string
          session_id?: string
          created_at?: string
          updated_at?: string
          summary_json?: unknown | null
          last_summary_text_hash?: string | null
          source_updated_at?: number | string | null
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          user_id: string
          session_id: string
          payload: unknown
          updated_at: string
          created_at: string | null
        }
        Insert: {
          user_id: string
          session_id: string
          payload: unknown
          updated_at: string
          created_at?: string | null
        }
        Update: {
          user_id?: string
          session_id?: string
          payload?: unknown
          updated_at?: string
          created_at?: string | null
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
