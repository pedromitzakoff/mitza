export type UserRole = "admin" | "gestor";

export type TaskType = "otimizacao" | "verificacao_saldo" | "report" | "outro";
export type TaskStatus = "pendente" | "feito" | "atrasado";
export type TaskRecurrence = "nenhuma" | "diaria" | "semanal" | "mensal";

export type CommentableType = "sprint" | "task";

/** Status CONTRATUAL do cliente — não confundir com a saúde OPERACIONAL da
 * conta (AccountHealth, em lib/attention-alerts.ts). São conceitos
 * diferentes de propósito: este é cadastral (o contrato está em vigor?),
 * aquele é sobre execução da semana. */
export type ClientContractStatus = "ativo" | "pausado" | "encerrado";
export type ClientMainObjective = "leads" | "vendas" | "reservas" | "reconhecimento" | "trafego" | "outro";

/** ISO: 1 = segunda ... 7 = domingo. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type OperationalActivityType =
  | "task_created"
  | "task_completed"
  | "task_updated"
  | "task_commented"
  | "sprint_commented";

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
        Relationships: [];
      };
      clients: {
        Row: {
          id: string;
          name: string;
          meta_ad_account_id: string;
          created_at: string;
          deleted_at: string | null;
          legal_name: string | null;
          status: ClientContractStatus;
          contract_start_date: string | null;
          contract_end_date: string | null;
          renewal_date: string | null;
          primary_manager_id: string | null;
          main_contact_name: string | null;
          main_contact_role: string | null;
          main_contact_email: string | null;
          main_contact_phone: string | null;
          financial_contact_name: string | null;
          financial_contact_email: string | null;
          financial_contact_phone: string | null;
          instagram_url: string | null;
          website_url: string | null;
          facebook_url: string | null;
          commercial_whatsapp: string | null;
          meta_ad_account_name: string | null;
          main_objective: ClientMainObjective | null;
          monthly_planned_spend: number | null;
          primary_kpi: string | null;
          primary_kpi_target: string | null;
          operational_summary: string | null;
          important_notes: string | null;
          agency_monthly_fee: number | null;
          billing_due_day: number | null;
          contracted_services: string[] | null;
          notice_period_days: number | null;
          main_product_or_service: string | null;
          operation_region: string | null;
          primary_audience: string | null;
          client_differentials: string | null;
          client_restrictions: string | null;
          important_seasonal_dates: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          meta_ad_account_id: string;
          created_at?: string;
          deleted_at?: string | null;
          legal_name?: string | null;
          status?: ClientContractStatus;
          contract_start_date?: string | null;
          contract_end_date?: string | null;
          renewal_date?: string | null;
          primary_manager_id?: string | null;
          main_contact_name?: string | null;
          main_contact_role?: string | null;
          main_contact_email?: string | null;
          main_contact_phone?: string | null;
          financial_contact_name?: string | null;
          financial_contact_email?: string | null;
          financial_contact_phone?: string | null;
          instagram_url?: string | null;
          website_url?: string | null;
          facebook_url?: string | null;
          commercial_whatsapp?: string | null;
          meta_ad_account_name?: string | null;
          main_objective?: ClientMainObjective | null;
          monthly_planned_spend?: number | null;
          primary_kpi?: string | null;
          primary_kpi_target?: string | null;
          operational_summary?: string | null;
          important_notes?: string | null;
          agency_monthly_fee?: number | null;
          billing_due_day?: number | null;
          contracted_services?: string[] | null;
          notice_period_days?: number | null;
          main_product_or_service?: string | null;
          operation_region?: string | null;
          primary_audience?: string | null;
          client_differentials?: string | null;
          client_restrictions?: string | null;
          important_seasonal_dates?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          meta_ad_account_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          legal_name?: string | null;
          status?: ClientContractStatus;
          contract_start_date?: string | null;
          contract_end_date?: string | null;
          renewal_date?: string | null;
          primary_manager_id?: string | null;
          main_contact_name?: string | null;
          main_contact_role?: string | null;
          main_contact_email?: string | null;
          main_contact_phone?: string | null;
          financial_contact_name?: string | null;
          financial_contact_email?: string | null;
          financial_contact_phone?: string | null;
          instagram_url?: string | null;
          website_url?: string | null;
          facebook_url?: string | null;
          commercial_whatsapp?: string | null;
          meta_ad_account_name?: string | null;
          main_objective?: ClientMainObjective | null;
          monthly_planned_spend?: number | null;
          primary_kpi?: string | null;
          primary_kpi_target?: string | null;
          operational_summary?: string | null;
          important_notes?: string | null;
          agency_monthly_fee?: number | null;
          billing_due_day?: number | null;
          contracted_services?: string[] | null;
          notice_period_days?: number | null;
          main_product_or_service?: string | null;
          operation_region?: string | null;
          primary_audience?: string | null;
          client_differentials?: string | null;
          client_restrictions?: string | null;
          important_seasonal_dates?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "clients_primary_manager_id_fkey";
            columns: ["primary_manager_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "client_managers_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_managers_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      sprints: {
        Row: {
          id: string;
          client_id: string;
          start_date: string;
          end_date: string;
          planned_spend: number;
          spend_source: "manual" | "meta_api";
          manual_actual_spend: number | null;
          manual_spend_updated_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          start_date: string;
          end_date: string;
          planned_spend?: number;
          spend_source?: "manual" | "meta_api";
          manual_actual_spend?: number | null;
          manual_spend_updated_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          start_date?: string;
          end_date?: string;
          planned_spend?: number;
          spend_source?: "manual" | "meta_api";
          manual_actual_spend?: number | null;
          manual_spend_updated_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sprints_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "daily_spend_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
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
          template_id: string | null;
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
          template_id?: string | null;
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
          template_id?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_sprint_id_fkey";
            columns: ["sprint_id"];
            isOneToOne: false;
            referencedRelation: "sprints";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "sprint_task_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      sprint_task_templates: {
        Row: {
          id: string;
          title: string;
          type: TaskType;
          default_assignee_id: string | null;
          weekday: Weekday;
          applies_to_all: boolean;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          type: TaskType;
          default_assignee_id?: string | null;
          weekday: Weekday;
          applies_to_all?: boolean;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          type?: TaskType;
          default_assignee_id?: string | null;
          weekday?: Weekday;
          applies_to_all?: boolean;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sprint_task_templates_default_assignee_id_fkey";
            columns: ["default_assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      sprint_task_template_clients: {
        Row: {
          template_id: string;
          client_id: string;
        };
        Insert: {
          template_id: string;
          client_id: string;
        };
        Update: {
          template_id?: string;
          client_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sprint_task_template_clients_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "sprint_task_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sprint_task_template_clients_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      client_task_templates: {
        Row: {
          id: string;
          client_id: string;
          title: string;
          type: TaskType;
          default_assignee_id: string | null;
          weekday: Weekday;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          title: string;
          type: TaskType;
          default_assignee_id?: string | null;
          weekday: Weekday;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          title?: string;
          type?: TaskType;
          default_assignee_id?: string | null;
          weekday?: Weekday;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_task_templates_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_task_templates_default_assignee_id_fkey";
            columns: ["default_assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      operational_activities: {
        Row: {
          id: string;
          client_id: string;
          sprint_id: string | null;
          task_id: string | null;
          user_id: string | null;
          activity_type: OperationalActivityType;
          source_type: string | null;
          source_id: string | null;
          metadata: Record<string, unknown> | null;
          occurred_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          sprint_id?: string | null;
          task_id?: string | null;
          user_id?: string | null;
          activity_type: OperationalActivityType;
          source_type?: string | null;
          source_id?: string | null;
          metadata?: Record<string, unknown> | null;
          occurred_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          sprint_id?: string | null;
          task_id?: string | null;
          user_id?: string | null;
          activity_type?: OperationalActivityType;
          source_type?: string | null;
          source_id?: string | null;
          metadata?: Record<string, unknown> | null;
          occurred_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "operational_activities_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operational_activities_sprint_id_fkey";
            columns: ["sprint_id"];
            isOneToOne: false;
            referencedRelation: "sprints";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operational_activities_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operational_activities_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      client_last_operational_activity: {
        Row: {
          client_id: string | null;
          last_activity_at: string | null;
        };
        Relationships: [];
      };
      sprint_last_operational_activity: {
        Row: {
          sprint_id: string | null;
          last_activity_at: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      backfill_sprint_tasks_from_templates: {
        Args: Record<PropertyKey, never>;
        Returns: void;
      };
      backfill_operational_activities: {
        Args: Record<PropertyKey, never>;
        Returns: void;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
