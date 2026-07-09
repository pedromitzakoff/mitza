export type UserRole = "admin" | "gestor";

export type TaskType = "otimizacao" | "verificacao_saldo" | "report" | "outro";
export type TaskStatus = "pendente" | "feito" | "atrasado";
export type TaskRecurrence = "nenhuma" | "diaria" | "semanal" | "mensal";

export type CommentableType = "sprint" | "task";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string;
          role: UserRole;
          created_at: string;
        };
        Insert: {
          id: string;
          name: string;
          role?: UserRole;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          role?: UserRole;
          created_at?: string;
        };
      };
      clients: {
        Row: {
          id: string;
          name: string;
          meta_ad_account_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          meta_ad_account_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          meta_ad_account_id?: string;
          created_at?: string;
        };
      };
      client_managers: {
        Row: {
          client_id: string;
          user_id: string;
        };
        Insert: {
          client_id: string;
          user_id: string;
        };
        Update: {
          client_id?: string;
          user_id?: string;
        };
      };
      sprints: {
        Row: {
          id: string;
          client_id: string;
          start_date: string;
          end_date: string;
          planned_spend: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          start_date: string;
          end_date: string;
          planned_spend?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          start_date?: string;
          end_date?: string;
          planned_spend?: number;
          created_at?: string;
        };
      };
      daily_spend: {
        Row: {
          id: string;
          client_id: string;
          date: string;
          spend: number;
          synced_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          date: string;
          spend?: number;
          synced_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          date?: string;
          spend?: number;
          synced_at?: string;
        };
      };
      tasks: {
        Row: {
          id: string;
          client_id: string;
          title: string;
          type: TaskType;
          assignee_id: string | null;
          due_date: string;
          status: TaskStatus;
          recurrence: TaskRecurrence;
          sprint_id: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          title: string;
          type: TaskType;
          assignee_id?: string | null;
          due_date: string;
          status?: TaskStatus;
          recurrence?: TaskRecurrence;
          sprint_id?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          title?: string;
          type?: TaskType;
          assignee_id?: string | null;
          due_date?: string;
          status?: TaskStatus;
          recurrence?: TaskRecurrence;
          sprint_id?: string | null;
          notes?: string | null;
          created_at?: string;
        };
      };
      comments: {
        Row: {
          id: string;
          commentable_type: CommentableType;
          commentable_id: string;
          author_id: string | null;
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          commentable_type: CommentableType;
          commentable_id: string;
          author_id?: string | null;
          content: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          commentable_type?: CommentableType;
          commentable_id?: string;
          author_id?: string | null;
          content?: string;
          created_at?: string;
        };
      };
    };
  };
}
