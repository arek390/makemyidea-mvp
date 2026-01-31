export type Database = {
  public: {
    Tables: {
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
          type: string
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
