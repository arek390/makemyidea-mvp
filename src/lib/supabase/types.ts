export type Database = {
  public: {
    Tables: {
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
