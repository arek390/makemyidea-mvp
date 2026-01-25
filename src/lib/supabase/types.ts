export type Database = {
  public: {
    Tables: {
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
