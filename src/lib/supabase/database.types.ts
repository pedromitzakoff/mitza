export type UserRole = "admin" | "gestor";

export type TaskType = "otimizacao" | "verificacao_saldo" | "report" | "outro" | "reuniao" | "entrega_criativo";
export type TaskStatus = "pendente" | "feito" | "atrasado" | "nao_realizado";
export type TaskRecurrence = "nenhuma" | "diaria" | "semanal" | "mensal";

export type CommentableType = "sprint" | "task";

/** Status CONTRATUAL do cliente — não confundir com a saúde OPERACIONAL da
 * conta (AccountHealth, em lib/attention-alerts.ts). São conceitos
 * diferentes de propósito: este é cadastral (o contrato está em vigor?),
 * aquele é sobre execução da semana. */
export type ClientContractStatus = "ativo" | "pausado" | "encerrado";
export type ClientMainObjective = "leads" | "vendas" | "reservas" | "reconhecimento" | "trafego" | "outro";
/** Objetivo estruturado de performance (Etapa 71; "followers" adicionado na
 * Etapa "Objetivo Seguidores") — distinto de `ClientMainObjective`. */
export type PerformanceGoalDb = "leads" | "sales" | "followers";

/** Fonte do resultado de um objetivo (Etapa "Múltiplos Objetivos") —
 * "automatic" = daily_performance/performance_records alimentado por
 * integração ou lançamento por sprint; "manual" = só lançamento manual por
 * período (hoje, sempre o caso de "followers", ver client_goals.sql). */
export type GoalResultSourceDb = "automatic" | "manual";

/** Tema visual do AnalyticsReport (Fase 1) — pertence ao domínio do cliente,
 * não é uma preferência de sessão. Sem UI de seleção ainda; hoje todo
 * cliente nasce "mitza". */
export type ReportThemeDb = "mitza" | "white_label";

/** Ciclo de vida de um `client_reports` — rótulos em `lib/client-reports.ts`
 * (`CLIENT_REPORT_STATUS_LABEL`). "sent" só é gravado por
 * `markClientReportSentAction`, nunca ao simplesmente salvar o conteúdo. */
export type ClientReportStatusDb = "draft" | "sent";
/** Módulo "Pendências" (Visão Geral da Agência) — nunca confundir com o
 * conceito homônimo do Core de diagnóstico (`diagnostics.pendencias`,
 * tarefas em aberto de um cliente, ver lib/metric-diagnostics.ts): são
 * entidades diferentes que só compartilham o nome em português. */
export type ReminderScopeDb = "agency" | "client";
export type ReminderStatusDb = "pending" | "done";
export type TrafficChannelDb = "meta" | "google" | "tiktok" | "linkedin" | "instagram" | "other";
export type PerformanceSourceDb = "manual" | "meta" | "google";

/** Integração Stract → Supabase → MITZA — provider é o único suportado
 * nesta primeira versão (Google/TikTok/LinkedIn ficam preparados
 * conceitualmente pelo `channel`, sem exigir nova migration quando chegarem). */
export type ImportProviderDb = "stract";
/** Saúde/configuração PERSISTENTE de uma import_source — distinto do status
 * de UMA execução (`DataSyncRunStatusDb`). */
export type ImportSourceStatusDb = "pending" | "active" | "error" | "disabled" | "no_data";
export type DataSyncRunStatusDb = "running" | "success" | "partial" | "failed" | "empty";
/** "Como o dado chegou" em `daily_performance` — nunca confundir com canal
 * (`TrafficChannelDb`) ou provedor (`ImportProviderDb`). */
export type DailyPerformanceSourceDb = "manual" | "import";

/** ISO: 1 = segunda ... 7 = domingo. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type OperationalActivityType =
  | "task_created"
  | "task_completed"
  | "task_updated"
  | "task_commented"
  | "sprint_commented";

export type KpiUnit = "numero" | "moeda" | "percentual";
export type KpiDirection = "maior_melhor" | "menor_melhor";
export type MonthlyReportStatus = "nao_iniciado" | "em_andamento" | "pronto_revisao" | "finalizado";
export type ReportTimelineEventType =
  | "orcamento"
  | "investimento"
  | "otimizacao"
  | "estrategia"
  | "teste_iniciado"
  | "teste_encerrado"
  | "problema"
  | "reuniao"
  | "entrega_criativo"
  | "performance"
  | "comentario"
  | "outro";
export type ReportActionItemStatus = "pendente" | "em_andamento" | "concluido";
export type ReportActionItemDependency = "agencia" | "cliente" | "terceiro";

/** Papel no SISTEMA (autorização) — não confundir com `job_title`, que é o
 * cargo operacional (descritivo, texto livre). */
export type TeamSystemRole = "admin" | "gestor";
export type TeamMemberStatus = "ativo" | "inativo";
export type TeamInvitationStatus = "sem_acesso" | "convite_pendente" | "acesso_ativo";

/** Taxonomia central de `operational_events` (Etapa 56) — ver
 * lib/operational-events.ts para os rótulos e o objeto `OperationalEventType`
 * usado no código (nunca strings soltas espalhadas pelo app). */
export type OperationalEventType =
  | "team_member_created"
  | "team_member_updated"
  | "team_member_deactivated"
  | "team_member_reactivated"
  | "team_member_invited"
  | "team_member_access_activated"
  | "team_member_access_revoked"
  | "team_member_deleted"
  | "client_created"
  | "client_manager_assigned"
  | "client_manager_changed"
  | "client_status_changed"
  | "task_created"
  | "task_assigned"
  | "task_reassigned"
  | "task_due_date_changed"
  | "task_completed"
  | "task_reopened"
  | "task_deleted"
  | "optimization_completed"
  | "meeting_scheduled"
  | "meeting_rescheduled"
  | "meeting_completed"
  | "meeting_cancelled"
  | "creative_delivery_scheduled"
  | "creative_delivery_completed"
  | "creative_delivery_late"
  | "monthly_budget_created"
  | "monthly_budget_changed"
  | "monthly_report_started"
  | "monthly_report_ready_for_review"
  | "monthly_report_finalized"
  | "monthly_report_reopened"
  | "account_review_recorded"
  | "account_review_no_change"
  | "account_review_optimization_performed"
  | "account_review_issue_identified"
  | "account_optimization_recorded"
  | "client_update_generated"
  | "client_update_edited"
  | "client_update_copied"
  | "client_update_marked_sent"
  | "client_update_marked_unsent"
  | "client_report_generated"
  | "client_report_edited"
  | "client_report_sent"
  | "achievement_unlocked";

export type OperationalEntityType =
  | "task"
  | "client"
  | "team_member"
  | "monthly_budget_change"
  | "monthly_report"
  | "account_review"
  | "account_optimization"
  | "client_update"
  | "client_report"
  | "achievement";
export type OperationalEventSource = "web" | "server" | "system" | "integration" | "migration" | "automation";

/** Etapa 57 — Análises da Conta e Otimizações (taxonomias). Rótulos em
 * lib/account-reviews.ts. */
export type AccountReviewReason =
  | "ROUTINE"
  | "PERFORMANCE_ALERT"
  | "INVESTMENT_ALERT"
  | "CLIENT_REQUEST"
  | "OPPORTUNITY"
  | "OTHER";
export type AccountReviewOutcome = "NO_CHANGE" | "OPTIMIZATION_PERFORMED" | "ISSUE_IDENTIFIED";
export type OptimizationType =
  | "CREATIVE"
  | "AUDIENCE"
  | "BID"
  | "BUDGET"
  | "CAMPAIGN"
  | "AD_SET"
  | "PLACEMENT"
  | "ACCOUNT_STRUCTURE"
  | "TRACKING"
  | "OTHER"
  | "REMARKETING";

/** Etapa 59 — Atualização para o Cliente. Rótulos em lib/client-updates.ts. */
export type ClientUpdateGenerationMethod = "template" | "ai";

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
      organizations: {
        Row: {
          id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      team_members: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          email: string;
          job_title: string | null;
          system_role: TeamSystemRole;
          status: TeamMemberStatus;
          avatar_url: string | null;
          auth_user_id: string | null;
          invitation_status: TeamInvitationStatus;
          invited_at: string | null;
          invited_by: string | null;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          email: string;
          job_title?: string | null;
          system_role?: TeamSystemRole;
          status?: TeamMemberStatus;
          avatar_url?: string | null;
          auth_user_id?: string | null;
          invitation_status?: TeamInvitationStatus;
          invited_at?: string | null;
          invited_by?: string | null;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          email?: string;
          job_title?: string | null;
          system_role?: TeamSystemRole;
          status?: TeamMemberStatus;
          avatar_url?: string | null;
          auth_user_id?: string | null;
          invitation_status?: TeamInvitationStatus;
          invited_at?: string | null;
          invited_by?: string | null;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
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
          cnpj: string | null;
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
          media_channels: string[];
          notice_period_days: number | null;
          main_product_or_service: string | null;
          operation_region: string | null;
          primary_audience: string | null;
          client_differentials: string | null;
          client_restrictions: string | null;
          important_seasonal_dates: string | null;
          performance_goal: PerformanceGoalDb | null;
          target_cost_per_result: number | null;
          wallet_position: number | null;
          avatar_url: string | null;
          dashboard_url: string | null;
          balance_url: string | null;
          monthly_closing_sheet_url: string | null;
          report_theme: ReportThemeDb;
        };
        Insert: {
          id?: string;
          name: string;
          meta_ad_account_id: string;
          created_at?: string;
          deleted_at?: string | null;
          legal_name?: string | null;
          cnpj?: string | null;
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
          media_channels?: string[];
          notice_period_days?: number | null;
          main_product_or_service?: string | null;
          operation_region?: string | null;
          primary_audience?: string | null;
          client_differentials?: string | null;
          client_restrictions?: string | null;
          important_seasonal_dates?: string | null;
          performance_goal?: PerformanceGoalDb | null;
          target_cost_per_result?: number | null;
          wallet_position?: number | null;
          avatar_url?: string | null;
          dashboard_url?: string | null;
          balance_url?: string | null;
          monthly_closing_sheet_url?: string | null;
          report_theme?: ReportThemeDb;
        };
        Update: {
          id?: string;
          name?: string;
          meta_ad_account_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          legal_name?: string | null;
          cnpj?: string | null;
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
          media_channels?: string[];
          notice_period_days?: number | null;
          main_product_or_service?: string | null;
          operation_region?: string | null;
          primary_audience?: string | null;
          client_differentials?: string | null;
          client_restrictions?: string | null;
          important_seasonal_dates?: string | null;
          performance_goal?: PerformanceGoalDb | null;
          target_cost_per_result?: number | null;
          wallet_position?: number | null;
          avatar_url?: string | null;
          dashboard_url?: string | null;
          balance_url?: string | null;
          monthly_closing_sheet_url?: string | null;
          report_theme?: ReportThemeDb;
        };
        Relationships: [
          {
            foreignKeyName: "clients_primary_manager_id_fkey";
            columns: ["primary_manager_id"];
            isOneToOne: false;
            referencedRelation: "team_members";
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
            referencedRelation: "team_members";
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
          original_planned_amount: number | null;
          final_recommended_amount: number | null;
          final_actual_amount: number | null;
          snapshot_frozen_at: string | null;
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
          original_planned_amount?: number | null;
          final_recommended_amount?: number | null;
          final_actual_amount?: number | null;
          snapshot_frozen_at?: string | null;
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
          original_planned_amount?: number | null;
          final_recommended_amount?: number | null;
          final_actual_amount?: number | null;
          snapshot_frozen_at?: string | null;
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
      performance_records: {
        Row: {
          id: string;
          client_id: string;
          sprint_id: string | null;
          channel: TrafficChannelDb;
          result_type: PerformanceGoalDb;
          result_count: number;
          revenue: number | null;
          period_start: string;
          period_end: string;
          source: PerformanceSourceDb;
          source_updated_at: string;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          client_id: string;
          sprint_id?: string | null;
          channel: TrafficChannelDb;
          result_type: PerformanceGoalDb;
          result_count?: number;
          revenue?: number | null;
          period_start: string;
          period_end: string;
          source?: PerformanceSourceDb;
          source_updated_at?: string;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          client_id?: string;
          sprint_id?: string | null;
          channel?: TrafficChannelDb;
          result_type?: PerformanceGoalDb;
          result_count?: number;
          revenue?: number | null;
          period_start?: string;
          period_end?: string;
          source?: PerformanceSourceDb;
          source_updated_at?: string;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "performance_records_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "performance_records_sprint_id_fkey";
            columns: ["sprint_id"];
            isOneToOne: false;
            referencedRelation: "sprints";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_spend: {
        Row: {
          id: string;
          client_id: string;
          date: string;
          channel: TrafficChannelDb;
          spend: number;
          synced_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          date: string;
          channel?: TrafficChannelDb;
          spend?: number;
          synced_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          date?: string;
          channel?: TrafficChannelDb;
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
      daily_performance: {
        Row: {
          id: string;
          client_id: string;
          date: string;
          channel: TrafficChannelDb;
          result_type: PerformanceGoalDb;
          result_count: number;
          revenue: number | null;
          source: DailyPerformanceSourceDb;
          provider: ImportProviderDb | null;
          source_updated_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          date: string;
          channel: TrafficChannelDb;
          result_type: PerformanceGoalDb;
          result_count?: number;
          revenue?: number | null;
          source?: DailyPerformanceSourceDb;
          provider?: ImportProviderDb | null;
          source_updated_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          date?: string;
          channel?: TrafficChannelDb;
          result_type?: PerformanceGoalDb;
          result_count?: number;
          revenue?: number | null;
          source?: DailyPerformanceSourceDb;
          provider?: ImportProviderDb | null;
          source_updated_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "daily_performance_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      instagram_daily_metrics: {
        Row: {
          id: string;
          client_id: string;
          import_source_id: string;
          date: string;
          new_followers: number;
          followers_total: number | null;
          reach: number | null;
          impressions: number | null;
          profile_views: number | null;
          accounts_engaged: number | null;
          raw_data: unknown;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          import_source_id: string;
          date: string;
          new_followers: number;
          followers_total?: number | null;
          reach?: number | null;
          impressions?: number | null;
          profile_views?: number | null;
          accounts_engaged?: number | null;
          raw_data?: unknown;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          import_source_id?: string;
          date?: string;
          new_followers?: number;
          followers_total?: number | null;
          reach?: number | null;
          impressions?: number | null;
          profile_views?: number | null;
          accounts_engaged?: number | null;
          raw_data?: unknown;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "instagram_daily_metrics_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "instagram_daily_metrics_import_source_id_fkey";
            columns: ["import_source_id"];
            isOneToOne: false;
            referencedRelation: "import_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      ad_creative_daily_metrics: {
        Row: {
          id: string;
          client_id: string;
          import_source_id: string;
          date: string;
          campaign_name: string;
          creative_name: string;
          creative_permalink_url: string | null;
          preview_image_url: string | null;
          spend: number;
          impressions: number | null;
          reach: number | null;
          clicks: number | null;
          result_type: PerformanceGoalDb | null;
          result_count: number | null;
          revenue: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          import_source_id: string;
          date: string;
          campaign_name: string;
          creative_name: string;
          creative_permalink_url?: string | null;
          preview_image_url?: string | null;
          spend?: number;
          impressions?: number | null;
          reach?: number | null;
          clicks?: number | null;
          result_type?: PerformanceGoalDb | null;
          result_count?: number | null;
          revenue?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          import_source_id?: string;
          date?: string;
          campaign_name?: string;
          creative_name?: string;
          creative_permalink_url?: string | null;
          preview_image_url?: string | null;
          spend?: number;
          impressions?: number | null;
          reach?: number | null;
          clicks?: number | null;
          result_type?: PerformanceGoalDb | null;
          result_count?: number | null;
          revenue?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ad_creative_daily_metrics_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ad_creative_daily_metrics_import_source_id_fkey";
            columns: ["import_source_id"];
            isOneToOne: false;
            referencedRelation: "import_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      campaign_daily_metrics: {
        Row: {
          id: string;
          client_id: string;
          import_source_id: string;
          channel: TrafficChannelDb;
          date: string;
          campaign_name: string;
          campaign_id: string | null;
          spend: number;
          impressions: number | null;
          reach: number | null;
          clicks: number | null;
          result_type: PerformanceGoalDb | null;
          result_count: number | null;
          revenue: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          import_source_id: string;
          channel: TrafficChannelDb;
          date: string;
          campaign_name: string;
          campaign_id?: string | null;
          spend?: number;
          impressions?: number | null;
          reach?: number | null;
          clicks?: number | null;
          result_type?: PerformanceGoalDb | null;
          result_count?: number | null;
          revenue?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          import_source_id?: string;
          channel?: TrafficChannelDb;
          date?: string;
          campaign_name?: string;
          campaign_id?: string | null;
          spend?: number;
          impressions?: number | null;
          reach?: number | null;
          clicks?: number | null;
          result_type?: PerformanceGoalDb | null;
          result_count?: number | null;
          revenue?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_daily_metrics_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_daily_metrics_import_source_id_fkey";
            columns: ["import_source_id"];
            isOneToOne: false;
            referencedRelation: "import_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      import_sources: {
        Row: {
          id: string;
          client_id: string;
          provider: ImportProviderDb;
          channel: TrafficChannelDb;
          external_account_id: string;
          table_name: string;
          account_id_column: string;
          date_column: string;
          spend_column: string;
          campaign_name_column: string | null;
          campaign_name_filter: string | null;
          campaign_name_exclude: string | null;
          campaign_id_column: string | null;
          ad_name_column: string | null;
          ad_set_name_column: string | null;
          creative_permalink_column: string | null;
          preview_image_column: string | null;
          preview_image_fallback_column: string | null;
          impressions_column: string | null;
          reach_column: string | null;
          clicks_column: string | null;
          status: ImportSourceStatusDb;
          enabled: boolean;
          last_imported_date: string | null;
          last_success_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          provider: ImportProviderDb;
          channel: TrafficChannelDb;
          external_account_id: string;
          table_name: string;
          account_id_column: string;
          date_column: string;
          spend_column: string;
          campaign_name_column?: string | null;
          campaign_name_filter?: string | null;
          campaign_name_exclude?: string | null;
          campaign_id_column?: string | null;
          ad_name_column?: string | null;
          ad_set_name_column?: string | null;
          creative_permalink_column?: string | null;
          preview_image_column?: string | null;
          preview_image_fallback_column?: string | null;
          impressions_column?: string | null;
          reach_column?: string | null;
          clicks_column?: string | null;
          status?: ImportSourceStatusDb;
          enabled?: boolean;
          last_imported_date?: string | null;
          last_success_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          provider?: ImportProviderDb;
          channel?: TrafficChannelDb;
          external_account_id?: string;
          table_name?: string;
          account_id_column?: string;
          date_column?: string;
          spend_column?: string;
          campaign_name_column?: string | null;
          campaign_name_filter?: string | null;
          campaign_name_exclude?: string | null;
          campaign_id_column?: string | null;
          ad_name_column?: string | null;
          ad_set_name_column?: string | null;
          creative_permalink_column?: string | null;
          preview_image_column?: string | null;
          preview_image_fallback_column?: string | null;
          impressions_column?: string | null;
          reach_column?: string | null;
          clicks_column?: string | null;
          status?: ImportSourceStatusDb;
          enabled?: boolean;
          last_imported_date?: string | null;
          last_success_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_sources_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      ad_set_daily_metrics: {
        Row: {
          id: string;
          client_id: string;
          import_source_id: string;
          channel: TrafficChannelDb;
          date: string;
          campaign_name: string;
          ad_set_name: string;
          spend: number;
          impressions: number | null;
          reach: number | null;
          clicks: number | null;
          result_type: PerformanceGoalDb | null;
          result_count: number | null;
          revenue: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          import_source_id: string;
          channel: TrafficChannelDb;
          date: string;
          campaign_name: string;
          ad_set_name: string;
          spend?: number;
          impressions?: number | null;
          reach?: number | null;
          clicks?: number | null;
          result_type?: PerformanceGoalDb | null;
          result_count?: number | null;
          revenue?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          import_source_id?: string;
          channel?: TrafficChannelDb;
          date?: string;
          campaign_name?: string;
          ad_set_name?: string;
          spend?: number;
          impressions?: number | null;
          reach?: number | null;
          clicks?: number | null;
          result_type?: PerformanceGoalDb | null;
          result_count?: number | null;
          revenue?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ad_set_daily_metrics_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ad_set_daily_metrics_import_source_id_fkey";
            columns: ["import_source_id"];
            isOneToOne: false;
            referencedRelation: "import_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      metric_mappings: {
        Row: {
          id: string;
          import_source_id: string;
          goal: PerformanceGoalDb;
          result_column: string;
          value_column: string | null;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          import_source_id: string;
          goal: PerformanceGoalDb;
          result_column: string;
          value_column?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          import_source_id?: string;
          goal?: PerformanceGoalDb;
          result_column?: string;
          value_column?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "metric_mappings_import_source_id_fkey";
            columns: ["import_source_id"];
            isOneToOne: false;
            referencedRelation: "import_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      data_sync_runs: {
        Row: {
          id: string;
          import_source_id: string;
          started_at: string;
          finished_at: string | null;
          status: DataSyncRunStatusDb;
          rows_read: number | null;
          spend_rows_written: number | null;
          performance_rows_written: number | null;
          creative_rows_written: number | null;
          campaign_rows_written: number | null;
          ad_set_rows_written: number | null;
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          import_source_id: string;
          started_at?: string;
          finished_at?: string | null;
          status?: DataSyncRunStatusDb;
          rows_read?: number | null;
          spend_rows_written?: number | null;
          performance_rows_written?: number | null;
          creative_rows_written?: number | null;
          campaign_rows_written?: number | null;
          ad_set_rows_written?: number | null;
          error_message?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          import_source_id?: string;
          started_at?: string;
          finished_at?: string | null;
          status?: DataSyncRunStatusDb;
          rows_read?: number | null;
          spend_rows_written?: number | null;
          performance_rows_written?: number | null;
          creative_rows_written?: number | null;
          campaign_rows_written?: number | null;
          ad_set_rows_written?: number | null;
          error_message?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "data_sync_runs_import_source_id_fkey";
            columns: ["import_source_id"];
            isOneToOne: false;
            referencedRelation: "import_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      sprint_channel_spend: {
        Row: {
          id: string;
          client_id: string;
          sprint_id: string;
          channel: TrafficChannelDb;
          spend_source: "manual" | "meta_api";
          manual_actual_spend: number | null;
          updated_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          sprint_id: string;
          channel: TrafficChannelDb;
          spend_source?: "manual" | "meta_api";
          manual_actual_spend?: number | null;
          updated_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          sprint_id?: string;
          channel?: TrafficChannelDb;
          spend_source?: "manual" | "meta_api";
          manual_actual_spend?: number | null;
          updated_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sprint_channel_spend_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sprint_channel_spend_sprint_id_fkey";
            columns: ["sprint_id"];
            isOneToOne: false;
            referencedRelation: "sprints";
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
          due_time: string | null;
          status: TaskStatus;
          recurrence: TaskRecurrence;
          sprint_id: string | null;
          template_id: string | null;
          notes: string | null;
          created_at: string;
          original_due_date: string;
          completed_at: string | null;
          completion_count: number;
          reassignment_count: number;
          due_date_change_count: number;
          reopened_count: number;
        };
        Insert: {
          id?: string;
          client_id: string;
          title: string;
          type: TaskType;
          assignee_id?: string | null;
          due_date: string;
          due_time?: string | null;
          status?: TaskStatus;
          recurrence?: TaskRecurrence;
          sprint_id?: string | null;
          template_id?: string | null;
          notes?: string | null;
          created_at?: string;
          /** NOT NULL sem default no banco (ver operational-events.sql) —
           * deliberadamente OBRIGATÓRIO aqui (nunca `?`), pra o typecheck
           * pegar em tempo de build qualquer insert que esqueça de
           * preencher esta coluna, em vez de só falhar em produção com um
           * erro cru do Postgres. */
          original_due_date: string;
          completed_at?: string | null;
          completion_count?: number;
          reassignment_count?: number;
          due_date_change_count?: number;
          reopened_count?: number;
        };
        Update: {
          id?: string;
          client_id?: string;
          title?: string;
          type?: TaskType;
          assignee_id?: string | null;
          due_date?: string;
          due_time?: string | null;
          status?: TaskStatus;
          recurrence?: TaskRecurrence;
          sprint_id?: string | null;
          template_id?: string | null;
          notes?: string | null;
          created_at?: string;
          original_due_date?: string;
          completed_at?: string | null;
          completion_count?: number;
          reassignment_count?: number;
          due_date_change_count?: number;
          reopened_count?: number;
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
            referencedRelation: "team_members";
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
            referencedRelation: "team_members";
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
            referencedRelation: "team_members";
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
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
        ];
      };
      operational_events: {
        Row: {
          id: string;
          organization_id: string;
          event_type: OperationalEventType;
          actor_team_member_id: string | null;
          actor_auth_user_id: string | null;
          client_id: string | null;
          sprint_id: string | null;
          entity_type: OperationalEntityType;
          entity_id: string;
          occurred_at: string;
          recorded_at: string;
          expected_at: string | null;
          completed_at: string | null;
          was_on_time: boolean | null;
          delay_seconds: number | null;
          source: OperationalEventSource;
          correlation_id: string | null;
          idempotency_key: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          event_type: OperationalEventType;
          actor_team_member_id?: string | null;
          actor_auth_user_id?: string | null;
          client_id?: string | null;
          sprint_id?: string | null;
          entity_type: OperationalEntityType;
          entity_id: string;
          occurred_at?: string;
          recorded_at?: string;
          expected_at?: string | null;
          completed_at?: string | null;
          was_on_time?: boolean | null;
          delay_seconds?: number | null;
          source?: OperationalEventSource;
          correlation_id?: string | null;
          idempotency_key?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          event_type?: OperationalEventType;
          actor_team_member_id?: string | null;
          actor_auth_user_id?: string | null;
          client_id?: string | null;
          sprint_id?: string | null;
          entity_type?: OperationalEntityType;
          entity_id?: string;
          occurred_at?: string;
          recorded_at?: string;
          expected_at?: string | null;
          completed_at?: string | null;
          was_on_time?: boolean | null;
          delay_seconds?: number | null;
          source?: OperationalEventSource;
          correlation_id?: string | null;
          idempotency_key?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "operational_events_actor_team_member_id_fkey";
            columns: ["actor_team_member_id"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operational_events_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operational_events_sprint_id_fkey";
            columns: ["sprint_id"];
            isOneToOne: false;
            referencedRelation: "sprints";
            referencedColumns: ["id"];
          },
        ];
      };
      account_review_cadences: {
        Row: {
          client_id: string;
          reviews_per_week: number;
          max_business_days_without_review: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          reviews_per_week?: number;
          max_business_days_without_review?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          client_id?: string;
          reviews_per_week?: number;
          max_business_days_without_review?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "account_review_cadences_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: true;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      account_reviews: {
        Row: {
          id: string;
          organization_id: string;
          client_id: string;
          sprint_id: string;
          team_member_id: string | null;
          performed_by_auth_user_id: string | null;
          reviewed_at: string;
          reason: AccountReviewReason;
          reason_other_description: string | null;
          outcome: AccountReviewOutcome;
          notes: string | null;
          issue_description: string | null;
          issue_category: string | null;
          issue_task_id: string | null;
          previous_review_at: string | null;
          seconds_since_previous_review: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          client_id: string;
          sprint_id: string;
          team_member_id?: string | null;
          performed_by_auth_user_id?: string | null;
          reviewed_at?: string;
          reason: AccountReviewReason;
          reason_other_description?: string | null;
          outcome: AccountReviewOutcome;
          notes?: string | null;
          issue_description?: string | null;
          issue_category?: string | null;
          issue_task_id?: string | null;
          previous_review_at?: string | null;
          seconds_since_previous_review?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          client_id?: string;
          sprint_id?: string;
          team_member_id?: string | null;
          performed_by_auth_user_id?: string | null;
          reviewed_at?: string;
          reason?: AccountReviewReason;
          reason_other_description?: string | null;
          outcome?: AccountReviewOutcome;
          notes?: string | null;
          issue_description?: string | null;
          issue_category?: string | null;
          issue_task_id?: string | null;
          previous_review_at?: string | null;
          seconds_since_previous_review?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "account_reviews_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "account_reviews_sprint_id_fkey";
            columns: ["sprint_id"];
            isOneToOne: false;
            referencedRelation: "sprints";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "account_reviews_team_member_id_fkey";
            columns: ["team_member_id"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "account_reviews_issue_task_id_fkey";
            columns: ["issue_task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      account_optimizations: {
        Row: {
          id: string;
          organization_id: string;
          account_review_id: string;
          client_id: string;
          sprint_id: string;
          optimization_type: OptimizationType;
          optimization_action: string;
          description: string | null;
          reason: string | null;
          expected_impact: string | null;
          quantity: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          account_review_id: string;
          client_id: string;
          sprint_id: string;
          optimization_type: OptimizationType;
          optimization_action: string;
          description?: string | null;
          reason?: string | null;
          expected_impact?: string | null;
          quantity?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          account_review_id?: string;
          client_id?: string;
          sprint_id?: string;
          optimization_type?: OptimizationType;
          optimization_action?: string;
          description?: string | null;
          reason?: string | null;
          expected_impact?: string | null;
          quantity?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "account_optimizations_account_review_id_fkey";
            columns: ["account_review_id"];
            isOneToOne: false;
            referencedRelation: "account_reviews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "account_optimizations_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      recurring_tasks: {
        Row: {
          id: string;
          title: string;
          icon: string;
          color: string;
          default_assignee_id: string | null;
          applies_to_all: boolean;
          is_active: boolean;
          has_checklist: boolean;
          uses_account_review: boolean;
          uses_report: boolean;
          cadence_mode: "automatic" | "fixed_days";
          fixed_weekdays: number[];
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          icon?: string;
          color?: string;
          default_assignee_id?: string | null;
          applies_to_all?: boolean;
          is_active?: boolean;
          has_checklist?: boolean;
          uses_account_review?: boolean;
          uses_report?: boolean;
          cadence_mode?: "automatic" | "fixed_days";
          fixed_weekdays?: number[];
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          icon?: string;
          color?: string;
          default_assignee_id?: string | null;
          applies_to_all?: boolean;
          is_active?: boolean;
          has_checklist?: boolean;
          uses_account_review?: boolean;
          uses_report?: boolean;
          cadence_mode?: "automatic" | "fixed_days";
          fixed_weekdays?: number[];
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recurring_tasks_default_assignee_id_fkey";
            columns: ["default_assignee_id"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
        ];
      };
      recurring_task_checklist_items: {
        Row: {
          id: string;
          recurring_task_id: string;
          item_key: string;
          label: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          recurring_task_id: string;
          item_key: string;
          label: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          recurring_task_id?: string;
          item_key?: string;
          label?: string;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recurring_task_checklist_items_recurring_task_id_fkey";
            columns: ["recurring_task_id"];
            isOneToOne: false;
            referencedRelation: "recurring_tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      recurring_task_clients: {
        Row: {
          recurring_task_id: string;
          client_id: string;
        };
        Insert: {
          recurring_task_id: string;
          client_id: string;
        };
        Update: {
          recurring_task_id?: string;
          client_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recurring_task_clients_recurring_task_id_fkey";
            columns: ["recurring_task_id"];
            isOneToOne: false;
            referencedRelation: "recurring_tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_task_clients_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      recurring_task_goal_history: {
        Row: {
          id: string;
          recurring_task_id: string;
          weekly_goal: number;
          effective_from: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          recurring_task_id: string;
          weekly_goal: number;
          effective_from?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          recurring_task_id?: string;
          weekly_goal?: number;
          effective_from?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recurring_task_goal_history_recurring_task_id_fkey";
            columns: ["recurring_task_id"];
            isOneToOne: false;
            referencedRelation: "recurring_tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      recurring_task_executions: {
        Row: {
          id: string;
          recurring_task_id: string;
          client_id: string;
          sprint_id: string;
          executed_at: string;
          team_member_id: string | null;
          performed_by_auth_user_id: string | null;
          account_review_id: string | null;
          checklist_selected_keys: string[] | null;
          optimization_selections: unknown | null;
          client_report_id: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          recurring_task_id: string;
          client_id: string;
          sprint_id: string;
          executed_at?: string;
          team_member_id?: string | null;
          performed_by_auth_user_id?: string | null;
          account_review_id?: string | null;
          checklist_selected_keys?: string[] | null;
          optimization_selections?: unknown | null;
          client_report_id?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          recurring_task_id?: string;
          client_id?: string;
          sprint_id?: string;
          executed_at?: string;
          team_member_id?: string | null;
          performed_by_auth_user_id?: string | null;
          account_review_id?: string | null;
          checklist_selected_keys?: string[] | null;
          optimization_selections?: unknown | null;
          client_report_id?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recurring_task_executions_recurring_task_id_fkey";
            columns: ["recurring_task_id"];
            isOneToOne: false;
            referencedRelation: "recurring_tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_task_executions_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_task_executions_sprint_id_fkey";
            columns: ["sprint_id"];
            isOneToOne: false;
            referencedRelation: "sprints";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_task_executions_account_review_id_fkey";
            columns: ["account_review_id"];
            isOneToOne: false;
            referencedRelation: "account_reviews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_task_executions_team_member_id_fkey";
            columns: ["team_member_id"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
        ];
      };
      client_updates: {
        Row: {
          id: string;
          organization_id: string;
          client_id: string;
          account_review_id: string;
          created_by: string | null;
          content: string;
          generation_method: ClientUpdateGenerationMethod;
          generated_at: string;
          updated_at: string;
          copied_at: string | null;
          copied_by: string | null;
          sent_at: string | null;
          sent_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          client_id: string;
          account_review_id: string;
          created_by?: string | null;
          content: string;
          generation_method?: ClientUpdateGenerationMethod;
          generated_at?: string;
          updated_at?: string;
          copied_at?: string | null;
          copied_by?: string | null;
          sent_at?: string | null;
          sent_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          client_id?: string;
          account_review_id?: string;
          created_by?: string | null;
          content?: string;
          generation_method?: ClientUpdateGenerationMethod;
          generated_at?: string;
          updated_at?: string;
          copied_at?: string | null;
          copied_by?: string | null;
          sent_at?: string | null;
          sent_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_updates_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_updates_account_review_id_fkey";
            columns: ["account_review_id"];
            isOneToOne: true;
            referencedRelation: "account_reviews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_updates_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_updates_copied_by_fkey";
            columns: ["copied_by"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_updates_sent_by_fkey";
            columns: ["sent_by"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
        ];
      };
      client_reports: {
        Row: {
          id: string;
          organization_id: string;
          client_id: string;
          period_start: string;
          period_end: string;
          performance_goal: PerformanceGoalDb | null;
          metrics: unknown;
          observations: string | null;
          final_text: string;
          status: ClientReportStatusDb;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          sent_at: string | null;
          sent_by: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          client_id: string;
          period_start: string;
          period_end: string;
          performance_goal?: PerformanceGoalDb | null;
          metrics?: unknown;
          observations?: string | null;
          final_text: string;
          status?: ClientReportStatusDb;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          sent_at?: string | null;
          sent_by?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          client_id?: string;
          period_start?: string;
          period_end?: string;
          performance_goal?: PerformanceGoalDb | null;
          metrics?: unknown;
          observations?: string | null;
          final_text?: string;
          status?: ClientReportStatusDb;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          sent_at?: string | null;
          sent_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "client_reports_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_reports_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_reports_sent_by_fkey";
            columns: ["sent_by"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
        ];
      };
      reminders: {
        Row: {
          id: string;
          organization_id: string;
          title: string;
          scope: ReminderScopeDb;
          client_id: string | null;
          assignee_id: string | null;
          due_date: string | null;
          notes: string | null;
          status: ReminderStatusDb;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          completed_by: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          title: string;
          scope: ReminderScopeDb;
          client_id?: string | null;
          assignee_id?: string | null;
          due_date?: string | null;
          notes?: string | null;
          status?: ReminderStatusDb;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          completed_by?: string | null;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          title?: string;
          scope?: ReminderScopeDb;
          client_id?: string | null;
          assignee_id?: string | null;
          due_date?: string | null;
          notes?: string | null;
          status?: ReminderStatusDb;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          completed_by?: string | null;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "reminders_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reminders_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reminders_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reminders_completed_by_fkey";
            columns: ["completed_by"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
        ];
      };
      sprint_planned_allocations: {
        Row: {
          id: string;
          sprint_id: string;
          client_id: string;
          date: string;
          planned_amount: number;
          updated_at: string;
          channel: string;
        };
        Insert: {
          id?: string;
          sprint_id: string;
          client_id: string;
          date: string;
          planned_amount?: number;
          updated_at?: string;
          channel?: string;
        };
        Update: {
          id?: string;
          sprint_id?: string;
          client_id?: string;
          date?: string;
          planned_amount?: number;
          updated_at?: string;
          channel?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sprint_planned_allocations_sprint_id_fkey";
            columns: ["sprint_id"];
            isOneToOne: false;
            referencedRelation: "sprints";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sprint_planned_allocations_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      client_month_horizons: {
        Row: {
          id: string;
          client_id: string;
          month: string;
          planning_end_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          month: string;
          planning_end_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          month?: string;
          planning_end_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_month_horizons_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      monthly_budget_changes: {
        Row: {
          id: string;
          client_id: string;
          month: string;
          effective_date: string;
          changed_by: string | null;
          previous_amount: number;
          new_amount: number;
          consolidated_amount: number;
          future_amount_distributed: number;
          resulting_total: number;
          is_below_consolidated: boolean;
          changed_at: string;
          reason: string | null;
          target_result_count: number | null;
          target_cost_per_result: number | null;
          channel: string;
          result_type: PerformanceGoalDb | null;
        };
        Insert: {
          id?: string;
          client_id: string;
          month: string;
          effective_date: string;
          changed_by?: string | null;
          previous_amount: number;
          new_amount: number;
          consolidated_amount: number;
          future_amount_distributed: number;
          resulting_total: number;
          is_below_consolidated?: boolean;
          changed_at?: string;
          reason?: string | null;
          target_result_count?: number | null;
          target_cost_per_result?: number | null;
          channel?: string;
          result_type?: PerformanceGoalDb | null;
        };
        Update: {
          id?: string;
          client_id?: string;
          month?: string;
          effective_date?: string;
          changed_by?: string | null;
          previous_amount?: number;
          new_amount?: number;
          consolidated_amount?: number;
          future_amount_distributed?: number;
          resulting_total?: number;
          is_below_consolidated?: boolean;
          changed_at?: string;
          reason?: string | null;
          target_result_count?: number | null;
          target_cost_per_result?: number | null;
          channel?: string;
          result_type?: PerformanceGoalDb | null;
        };
        Relationships: [
          {
            foreignKeyName: "monthly_budget_changes_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "monthly_budget_changes_changed_by_fkey";
            columns: ["changed_by"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
        ];
      };
      client_kpi_definitions: {
        Row: {
          id: string;
          client_id: string;
          name: string;
          unit: KpiUnit;
          target: number | null;
          direction: KpiDirection;
          display_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          name: string;
          unit?: KpiUnit;
          target?: number | null;
          direction?: KpiDirection;
          display_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          name?: string;
          unit?: KpiUnit;
          target?: number | null;
          direction?: KpiDirection;
          display_order?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_kpi_definitions_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      client_goals: {
        Row: {
          id: string;
          client_id: string;
          result_type: PerformanceGoalDb;
          channels: string[];
          is_primary: boolean;
          result_source: GoalResultSourceDb;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          result_type: PerformanceGoalDb;
          channels?: string[];
          is_primary?: boolean;
          result_source?: GoalResultSourceDb;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          result_type?: PerformanceGoalDb;
          channels?: string[];
          is_primary?: boolean;
          result_source?: GoalResultSourceDb;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_goals_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      client_campaign_goal_assignments: {
        Row: {
          id: string;
          client_id: string;
          channel: TrafficChannelDb;
          campaign_id: string;
          result_type: PerformanceGoalDb;
          assigned_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          channel: TrafficChannelDb;
          campaign_id: string;
          result_type: PerformanceGoalDb;
          assigned_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          channel?: TrafficChannelDb;
          campaign_id?: string;
          result_type?: PerformanceGoalDb;
          assigned_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_campaign_goal_assignments_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_campaign_goal_assignments_assigned_by_fkey";
            columns: ["assigned_by"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
        ];
      };
      monthly_reports: {
        Row: {
          id: string;
          client_id: string;
          month_start: string;
          status: MonthlyReportStatus;
          executive_summary: string | null;
          next_month_priority: string | null;
          next_month_problems: string | null;
          next_month_opportunities: string | null;
          next_month_tests: string | null;
          analysis_what_worked: string | null;
          analysis_what_didnt_work: string | null;
          analysis_problems: string | null;
          analysis_opportunities: string | null;
          analysis_learnings: string | null;
          finalized_by: string | null;
          finalized_at: string | null;
          snapshot: Record<string, unknown> | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          month_start: string;
          status?: MonthlyReportStatus;
          executive_summary?: string | null;
          next_month_priority?: string | null;
          next_month_problems?: string | null;
          next_month_opportunities?: string | null;
          next_month_tests?: string | null;
          analysis_what_worked?: string | null;
          analysis_what_didnt_work?: string | null;
          analysis_problems?: string | null;
          analysis_opportunities?: string | null;
          analysis_learnings?: string | null;
          finalized_by?: string | null;
          finalized_at?: string | null;
          snapshot?: Record<string, unknown> | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          month_start?: string;
          status?: MonthlyReportStatus;
          executive_summary?: string | null;
          next_month_priority?: string | null;
          next_month_problems?: string | null;
          next_month_opportunities?: string | null;
          next_month_tests?: string | null;
          analysis_what_worked?: string | null;
          analysis_what_didnt_work?: string | null;
          analysis_problems?: string | null;
          analysis_opportunities?: string | null;
          analysis_learnings?: string | null;
          finalized_by?: string | null;
          finalized_at?: string | null;
          snapshot?: Record<string, unknown> | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "monthly_reports_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "monthly_reports_finalized_by_fkey";
            columns: ["finalized_by"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
        ];
      };
      report_kpi_values: {
        Row: {
          id: string;
          report_id: string;
          kpi_definition_id: string;
          result: number | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          report_id: string;
          kpi_definition_id: string;
          result?: number | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          report_id?: string;
          kpi_definition_id?: string;
          result?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "report_kpi_values_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "monthly_reports";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "report_kpi_values_kpi_definition_id_fkey";
            columns: ["kpi_definition_id"];
            isOneToOne: false;
            referencedRelation: "client_kpi_definitions";
            referencedColumns: ["id"];
          },
        ];
      };
      report_timeline_events: {
        Row: {
          id: string;
          report_id: string;
          event_date: string;
          type: ReportTimelineEventType;
          description: string;
          responsible_id: string | null;
          source_comment_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          report_id: string;
          event_date: string;
          type?: ReportTimelineEventType;
          description: string;
          responsible_id?: string | null;
          source_comment_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          report_id?: string;
          event_date?: string;
          type?: ReportTimelineEventType;
          description?: string;
          responsible_id?: string | null;
          source_comment_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "report_timeline_events_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "monthly_reports";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "report_timeline_events_responsible_id_fkey";
            columns: ["responsible_id"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "report_timeline_events_source_comment_id_fkey";
            columns: ["source_comment_id"];
            isOneToOne: false;
            referencedRelation: "comments";
            referencedColumns: ["id"];
          },
        ];
      };
      report_comment_selections: {
        Row: {
          id: string;
          report_id: string;
          comment_id: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          report_id: string;
          comment_id: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          report_id?: string;
          comment_id?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "report_comment_selections_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "monthly_reports";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "report_comment_selections_comment_id_fkey";
            columns: ["comment_id"];
            isOneToOne: false;
            referencedRelation: "comments";
            referencedColumns: ["id"];
          },
        ];
      };
      report_action_items: {
        Row: {
          id: string;
          report_id: string;
          title: string | null;
          description: string;
          responsible_id: string | null;
          due_date: string | null;
          dependency: ReportActionItemDependency | null;
          status: ReportActionItemStatus;
          sent_to_task_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          report_id: string;
          title?: string | null;
          description: string;
          responsible_id?: string | null;
          due_date?: string | null;
          dependency?: ReportActionItemDependency | null;
          status?: ReportActionItemStatus;
          sent_to_task_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          report_id?: string;
          title?: string | null;
          description?: string;
          responsible_id?: string | null;
          due_date?: string | null;
          dependency?: ReportActionItemDependency | null;
          status?: ReportActionItemStatus;
          sent_to_task_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "report_action_items_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "monthly_reports";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "report_action_items_responsible_id_fkey";
            columns: ["responsible_id"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "report_action_items_sent_to_task_id_fkey";
            columns: ["sent_to_task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_notes: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          content: string;
          is_pinned: boolean;
          context_path: string | null;
          context_label: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string;
          content?: string;
          is_pinned?: boolean;
          context_path?: string | null;
          context_label?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          content?: string;
          is_pinned?: boolean;
          context_path?: string | null;
          context_label?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_notes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "team_members";
            referencedColumns: ["id"];
          },
        ];
      };
      report_share_links: {
        Row: {
          id: string;
          client_id: string;
          token_hash: string;
          created_at: string;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          client_id: string;
          token_hash: string;
          created_at?: string;
          revoked_at?: string | null;
        };
        Update: {
          id?: string;
          client_id?: string;
          token_hash?: string;
          created_at?: string;
          revoked_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "report_share_links_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
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
      backfill_sprint_planned_allocations: {
        Args: Record<PropertyKey, never>;
        Returns: void;
      };
      apply_monthly_budget_change: {
        Args: {
          p_client_id: string;
          p_first_day: string;
          p_last_day: string;
          p_effective_date: string;
          p_new_budget: number;
          p_today: string;
          p_changed_by: string;
          p_reason?: string | null;
          p_target_result_count?: number | null;
          p_target_cost_per_result?: number | null;
        };
        Returns: {
          consolidatedAmount: number;
          futureBudgetAvailable: number;
          resultingTotal: number;
          isBelowConsolidated: boolean;
        };
      };
      apply_monthly_channel_plan_change: {
        Args: {
          p_client_id: string;
          p_channel: string;
          p_first_day: string;
          p_last_day: string;
          p_effective_date: string;
          p_new_budget: number;
          p_today: string;
          p_changed_by: string;
          p_reason?: string | null;
          p_target_result_count?: number | null;
          p_result_type?: PerformanceGoalDb | null;
        };
        Returns: {
          consolidatedAmount: number;
          futureBudgetAvailable: number;
          resultingTotal: number;
          isBelowConsolidated: boolean;
        };
      };
      set_client_goal_primary: {
        Args: {
          p_client_id: string;
          p_goal_id: string;
        };
        Returns: void;
      };
      set_goal_monthly_target: {
        Args: {
          p_client_id: string;
          p_channel: string;
          p_month: string;
          p_result_type: PerformanceGoalDb;
          p_target_result_count: number;
          p_changed_by: string;
          p_reason?: string | null;
        };
        Returns: void;
      };
      ensure_client_sprints: {
        Args: {
          p_client_id: string;
          p_horizon_months?: number;
        };
        Returns: void;
      };
      ensure_client_sprints_for_range: {
        Args: {
          p_client_id: string;
          p_start_date: string;
          p_end_date: string;
        };
        Returns: void;
      };
      complete_task_and_record_event: {
        Args: {
          p_task_id: string;
          p_actor_team_member_id: string;
          p_actor_auth_user_id: string | null;
          p_source?: OperationalEventSource;
        };
        Returns: {
          correlationId: string;
          wasOnTime: boolean;
          delaySeconds: number;
        };
      };
      record_achievement_event: {
        Args: {
          p_organization_id: string;
          p_client_id: string | null;
          p_actor_team_member_id: string | null;
          p_occurred_at: string;
          p_idempotency_key: string;
          p_metadata: Record<string, unknown>;
        };
        Returns: {
          eventId: string | null;
          inserted: boolean;
        };
      };
      mark_task_not_done_and_record_event: {
        Args: {
          p_task_id: string;
          p_actor_team_member_id: string;
          p_actor_auth_user_id: string | null;
          p_source?: OperationalEventSource;
        };
        Returns: {
          status: string;
          resolvedAt: string;
        };
      };
      record_account_review: {
        Args: {
          p_client_id: string;
          p_team_member_id: string;
          p_auth_user_id: string | null;
          p_reason: AccountReviewReason;
          p_reason_other_description: string | null;
          p_outcome: AccountReviewOutcome;
          p_notes: string | null;
          p_issue_description: string | null;
          p_issue_category: string | null;
          p_optimizations: unknown;
          p_create_task: boolean;
          p_task_responsible_id: string | null;
          p_task_due_date: string | null;
          p_source?: OperationalEventSource;
        };
        Returns: {
          reviewId: string;
          sprintId: string;
          taskId: string | null;
        };
      };
      register_recurring_execution: {
        Args: {
          p_recurring_task_id: string;
          p_client_id: string;
          p_team_member_id: string;
          p_auth_user_id: string | null;
          p_notes: string | null;
          p_checklist_selected_keys?: string[] | null;
          p_optimization_selections?: unknown | null;
          p_client_report_id?: string | null;
          p_source?: OperationalEventSource;
        };
        Returns: {
          executionId: string;
          sprintId: string;
          accountReviewId: string | null;
        };
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
