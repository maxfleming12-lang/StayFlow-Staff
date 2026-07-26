/**
 * Database types for StayFlow Staff.
 *
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate after any migration change:
 *   supabase db reset            # apply migrations locally
 *   supabase gen types typescript --local > src/types/database.ts
 *
 * Against a linked remote project instead:
 *   supabase gen types typescript --linked > src/types/database.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      announcement_acknowledgements: {
        Row: {
          acknowledged_at: string | null
          announcement_id: string
          created_at: string
          id: string
          organisation_id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          announcement_id: string
          created_at?: string
          id?: string
          organisation_id: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          announcement_id?: string
          created_at?: string
          id?: string
          organisation_id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_acknowledgements_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_acknowledgements_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_recipients: {
        Row: {
          all_staff: boolean
          announcement_id: string
          created_at: string
          id: string
          organisation_id: string
          property_id: string | null
          team_id: string | null
          user_id: string | null
        }
        Insert: {
          all_staff?: boolean
          announcement_id: string
          created_at?: string
          id?: string
          organisation_id: string
          property_id?: string | null
          team_id?: string | null
          user_id?: string | null
        }
        Update: {
          all_staff?: boolean
          announcement_id?: string
          created_at?: string
          id?: string
          organisation_id?: string
          property_id?: string | null
          team_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcement_recipients_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_recipients_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_recipients_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_recipients_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          archived_at: string | null
          attachment_path: string | null
          body: string
          category: Database["public"]["Enums"]["announcement_category"]
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_urgent: boolean
          organisation_id: string
          property_id: string | null
          published_at: string | null
          published_by: string | null
          requires_ack: boolean
          scheduled_for: string | null
          status: Database["public"]["Enums"]["announcement_status"]
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          attachment_path?: string | null
          body: string
          category?: Database["public"]["Enums"]["announcement_category"]
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_urgent?: boolean
          organisation_id: string
          property_id?: string | null
          published_at?: string | null
          published_by?: string | null
          requires_ack?: boolean
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["announcement_status"]
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          attachment_path?: string | null
          body?: string
          category?: Database["public"]["Enums"]["announcement_category"]
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_urgent?: boolean
          organisation_id?: string
          property_id?: string | null
          published_at?: string | null
          published_by?: string | null
          requires_ack?: boolean
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["announcement_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          after_value: Json | null
          before_value: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          organisation_id: string
          property_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          organisation_id: string
          property_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          organisation_id?: string
          property_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_tokens: {
        Row: {
          created_at: string
          id: string
          last_used_at: string | null
          organisation_id: string
          revoked_at: string | null
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          organisation_id: string
          revoked_at?: string | null
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          organisation_id?: string
          revoked_at?: string | null
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_tokens_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      clock_events: {
        Row: {
          client_time: string | null
          created_at: string
          device_id: string | null
          entered_by: string | null
          entry_reason: string | null
          event_type: Database["public"]["Enums"]["clock_event_type"]
          flag_reason: string | null
          id: string
          idempotency_key: string | null
          is_flagged: boolean
          latitude: number | null
          location_accuracy: number | null
          longitude: number | null
          organisation_id: string
          property_id: string
          received_at: string
          server_time: string
          shift_id: string | null
          source: Database["public"]["Enums"]["clock_source"]
          user_id: string
          was_offline: boolean
        }
        Insert: {
          client_time?: string | null
          created_at?: string
          device_id?: string | null
          entered_by?: string | null
          entry_reason?: string | null
          event_type: Database["public"]["Enums"]["clock_event_type"]
          flag_reason?: string | null
          id?: string
          idempotency_key?: string | null
          is_flagged?: boolean
          latitude?: number | null
          location_accuracy?: number | null
          longitude?: number | null
          organisation_id: string
          property_id: string
          received_at?: string
          server_time?: string
          shift_id?: string | null
          source?: Database["public"]["Enums"]["clock_source"]
          user_id: string
          was_offline?: boolean
        }
        Update: {
          client_time?: string | null
          created_at?: string
          device_id?: string | null
          entered_by?: string | null
          entry_reason?: string | null
          event_type?: Database["public"]["Enums"]["clock_event_type"]
          flag_reason?: string | null
          id?: string
          idempotency_key?: string | null
          is_flagged?: boolean
          latitude?: number | null
          location_accuracy?: number | null
          longitude?: number | null
          organisation_id?: string
          property_id?: string
          received_at?: string
          server_time?: string
          shift_id?: string | null
          source?: Database["public"]["Enums"]["clock_source"]
          user_id?: string
          was_offline?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "clock_events_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clock_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clock_events_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      document_acknowledgements: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          document_id: string
          id: string
          organisation_id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          document_id: string
          id?: string
          organisation_id: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          document_id?: string
          id?: string
          organisation_id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_acknowledgements_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_acknowledgements_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_permissions: {
        Row: {
          created_at: string
          document_id: string
          id: string
          organisation_id: string
          property_id: string | null
          role: Database["public"]["Enums"]["app_role"] | null
          team_id: string | null
        }
        Insert: {
          created_at?: string
          document_id: string
          id?: string
          organisation_id: string
          property_id?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          team_id?: string | null
        }
        Update: {
          created_at?: string
          document_id?: string
          id?: string
          organisation_id?: string
          property_id?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_permissions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_permissions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_permissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_permissions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          file_size_bytes: number | null
          folder: string
          id: string
          mime_type: string | null
          organisation_id: string
          property_id: string | null
          requires_ack: boolean
          storage_path: string
          supersedes_id: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_size_bytes?: number | null
          folder?: string
          id?: string
          mime_type?: string | null
          organisation_id: string
          property_id?: string | null
          requires_ack?: boolean
          storage_path: string
          supersedes_id?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_size_bytes?: number | null
          folder?: string
          id?: string
          mime_type?: string | null
          organisation_id?: string
          property_id?: string | null
          requires_ack?: boolean
          storage_path?: string
          supersedes_id?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "documents_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_contacts: {
        Row: {
          alternate_phone: string | null
          archived_at: string | null
          created_at: string
          full_name: string
          id: string
          is_primary: boolean
          organisation_id: string
          phone: string
          relationship: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          alternate_phone?: string | null
          archived_at?: string | null
          created_at?: string
          full_name: string
          id?: string
          is_primary?: boolean
          organisation_id: string
          phone: string
          relationship?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          alternate_phone?: string | null
          archived_at?: string | null
          created_at?: string
          full_name?: string
          id?: string
          is_primary?: boolean
          organisation_id?: string
          phone?: string
          relationship?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emergency_contacts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      employment_details: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          employment_type: Database["public"]["Enums"]["employment_type"]
          end_date: string | null
          hourly_rate: number | null
          id: string
          job_title: string | null
          organisation_id: string
          payroll_reference: string | null
          standard_weekly_hours: number | null
          start_date: string | null
          status: Database["public"]["Enums"]["employment_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          employment_type?: Database["public"]["Enums"]["employment_type"]
          end_date?: string | null
          hourly_rate?: number | null
          id?: string
          job_title?: string | null
          organisation_id: string
          payroll_reference?: string | null
          standard_weekly_hours?: number | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["employment_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          employment_type?: Database["public"]["Enums"]["employment_type"]
          end_date?: string | null
          hourly_rate?: number | null
          id?: string
          job_title?: string | null
          organisation_id?: string
          payroll_reference?: string | null
          standard_weekly_hours?: number | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["employment_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employment_details_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      kiosk_credentials: {
        Row: {
          created_at: string
          failed_attempts: number
          id: string
          last_used_at: string | null
          locked_until: string | null
          organisation_id: string
          pin_hash: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          failed_attempts?: number
          id?: string
          last_used_at?: string | null
          locked_until?: string | null
          organisation_id: string
          pin_hash: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          failed_attempts?: number
          id?: string
          last_used_at?: string | null
          locked_until?: string | null
          organisation_id?: string
          pin_hash?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kiosk_credentials_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          archived_at: string | null
          attachment_path: string | null
          category: Database["public"]["Enums"]["leave_category"]
          created_at: string
          created_by: string | null
          end_time: string | null
          first_date: string
          id: string
          is_partial_day: boolean
          last_date: string
          manager_note: string | null
          note: string | null
          organisation_id: string
          property_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["leave_status"]
          total_hours: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          attachment_path?: string | null
          category: Database["public"]["Enums"]["leave_category"]
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          first_date: string
          id?: string
          is_partial_day?: boolean
          last_date: string
          manager_note?: string | null
          note?: string | null
          organisation_id: string
          property_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["leave_status"]
          total_hours?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          attachment_path?: string | null
          category?: Database["public"]["Enums"]["leave_category"]
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          first_date?: string
          id?: string
          is_partial_day?: boolean
          last_date?: string
          manager_note?: string | null
          note?: string | null
          organisation_id?: string
          property_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["leave_status"]
          total_hours?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string
          id: string
          muted_categories: Database["public"]["Enums"]["notification_category"][]
          organisation_id: string
          push_enabled: boolean
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          muted_categories?: Database["public"]["Enums"]["notification_category"][]
          organisation_id: string
          push_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          muted_categories?: Database["public"]["Enums"]["notification_category"][]
          organisation_id?: string
          push_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          archived_at: string | null
          body: string
          category: Database["public"]["Enums"]["notification_category"]
          created_at: string
          deep_link: string | null
          id: string
          is_urgent: boolean
          organisation_id: string
          property_id: string | null
          push_error: string | null
          push_failed_at: string | null
          push_sent_at: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          body: string
          category: Database["public"]["Enums"]["notification_category"]
          created_at?: string
          deep_link?: string | null
          id?: string
          is_urgent?: boolean
          organisation_id: string
          property_id?: string | null
          push_error?: string | null
          push_failed_at?: string | null
          push_sent_at?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          body?: string
          category?: Database["public"]["Enums"]["notification_category"]
          created_at?: string
          deep_link?: string | null
          id?: string
          is_urgent?: boolean
          organisation_id?: string
          property_id?: string | null
          push_error?: string | null
          push_failed_at?: string | null
          push_sent_at?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      open_shift_offers: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          created_by: string | null
          id: string
          offered_to_user_id: string | null
          organisation_id: string
          shift_id: string
          status: Database["public"]["Enums"]["replacement_status"]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          offered_to_user_id?: string | null
          organisation_id: string
          shift_id: string
          status?: Database["public"]["Enums"]["replacement_status"]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          offered_to_user_id?: string | null
          organisation_id?: string
          shift_id?: string
          status?: Database["public"]["Enums"]["replacement_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "open_shift_offers_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shift_offers_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_settings: {
        Row: {
          ack_reminder_hours: number
          auto_approve_open_shifts: boolean
          clocking_mode: Database["public"]["Enums"]["clocking_mode"]
          created_at: string
          geofence_radius_metres: number | null
          id: string
          kiosk_lockout_minutes: number
          kiosk_pin_max_attempts: number
          minimum_rest_hours: number
          organisation_id: string
          pay_period: Database["public"]["Enums"]["pay_period_type"]
          pay_period_anchor_date: string
          require_shift_ack: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ack_reminder_hours?: number
          auto_approve_open_shifts?: boolean
          clocking_mode?: Database["public"]["Enums"]["clocking_mode"]
          created_at?: string
          geofence_radius_metres?: number | null
          id?: string
          kiosk_lockout_minutes?: number
          kiosk_pin_max_attempts?: number
          minimum_rest_hours?: number
          organisation_id: string
          pay_period?: Database["public"]["Enums"]["pay_period_type"]
          pay_period_anchor_date?: string
          require_shift_ack?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ack_reminder_hours?: number
          auto_approve_open_shifts?: boolean
          clocking_mode?: Database["public"]["Enums"]["clocking_mode"]
          created_at?: string
          geofence_radius_metres?: number | null
          id?: string
          kiosk_lockout_minutes?: number
          kiosk_pin_max_attempts?: number
          minimum_rest_hours?: number
          organisation_id?: string
          pay_period?: Database["public"]["Enums"]["pay_period_type"]
          pay_period_anchor_date?: string
          require_shift_ack?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organisation_settings_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: true
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      organisations: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          legal_name: string | null
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          legal_name?: string | null
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          legal_name?: string | null
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          email: string
          id: string
          is_active: boolean
          is_demo_account: boolean
          job_title: string | null
          legal_first_name: string
          legal_last_name: string
          mobile_number: string | null
          organisation_id: string
          preferred_name: string | null
          primary_property_id: string | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          id: string
          is_active?: boolean
          is_demo_account?: boolean
          job_title?: string | null
          legal_first_name?: string
          legal_last_name?: string
          mobile_number?: string | null
          organisation_id: string
          preferred_name?: string | null
          primary_property_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          is_active?: boolean
          is_demo_account?: boolean
          job_title?: string | null
          legal_first_name?: string
          legal_last_name?: string
          mobile_number?: string | null
          organisation_id?: string
          preferred_name?: string | null
          primary_property_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_primary_property_id_fkey"
            columns: ["primary_property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address: string | null
          archived_at: string | null
          colour: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          organisation_id: string
          short_code: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          colour?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          organisation_id: string
          short_code: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          colour?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organisation_id?: string
          short_code?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          device_label: string | null
          endpoint: string
          failure_count: number
          id: string
          last_used_at: string | null
          organisation_id: string
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          device_label?: string | null
          endpoint: string
          failure_count?: number
          id?: string
          last_used_at?: string | null
          organisation_id: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          device_label?: string | null
          endpoint?: string
          failure_count?: number
          id?: string
          last_used_at?: string | null
          organisation_id?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_periods: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          id: string
          is_template: boolean
          organisation_id: string
          property_id: string
          publish_message: string | null
          published_at: string | null
          published_by: string | null
          requires_ack: boolean
          status: Database["public"]["Enums"]["roster_status"]
          template_name: string | null
          updated_at: string
          week_start_date: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_template?: boolean
          organisation_id: string
          property_id: string
          publish_message?: string | null
          published_at?: string | null
          published_by?: string | null
          requires_ack?: boolean
          status?: Database["public"]["Enums"]["roster_status"]
          template_name?: string | null
          updated_at?: string
          week_start_date: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_template?: boolean
          organisation_id?: string
          property_id?: string
          publish_message?: string | null
          published_at?: string | null
          published_by?: string | null
          requires_ack?: boolean
          status?: Database["public"]["Enums"]["roster_status"]
          template_name?: string | null
          updated_at?: string
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "roster_periods_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_periods_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_acknowledgements: {
        Row: {
          created_at: string
          decline_reason: string | null
          id: string
          organisation_id: string
          responded_at: string | null
          shift_id: string
          status: Database["public"]["Enums"]["acknowledgement_status"]
          updated_at: string
          user_id: string
          viewed_at: string | null
        }
        Insert: {
          created_at?: string
          decline_reason?: string | null
          id?: string
          organisation_id: string
          responded_at?: string | null
          shift_id: string
          status?: Database["public"]["Enums"]["acknowledgement_status"]
          updated_at?: string
          user_id: string
          viewed_at?: string | null
        }
        Update: {
          created_at?: string
          decline_reason?: string | null
          id?: string
          organisation_id?: string
          responded_at?: string | null
          shift_id?: string
          status?: Database["public"]["Enums"]["acknowledgement_status"]
          updated_at?: string
          user_id?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_acknowledgements_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_acknowledgements_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_breaks: {
        Row: {
          created_at: string
          duration_minutes: number
          id: string
          is_paid: boolean
          organisation_id: string
          shift_id: string
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_minutes: number
          id?: string
          is_paid?: boolean
          organisation_id: string
          shift_id: string
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_minutes?: number
          id?: string
          is_paid?: boolean
          organisation_id?: string
          shift_id?: string
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_breaks_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_breaks_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_replacement_requests: {
        Row: {
          created_at: string
          id: string
          manager_note: string | null
          organisation_id: string
          reason: string | null
          replacement_user_id: string | null
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          shift_id: string
          status: Database["public"]["Enums"]["replacement_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          manager_note?: string | null
          organisation_id: string
          reason?: string | null
          replacement_user_id?: string | null
          requested_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift_id: string
          status?: Database["public"]["Enums"]["replacement_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          manager_note?: string | null
          organisation_id?: string
          reason?: string | null
          replacement_user_id?: string | null
          requested_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift_id?: string
          status?: Database["public"]["Enums"]["replacement_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_replacement_requests_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_replacement_requests_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          is_open_shift: boolean
          notes: string | null
          organisation_id: string
          overridden_by: string | null
          override_reason: string | null
          property_id: string
          published_at: string | null
          published_by: string | null
          required_role: string | null
          required_skill: string | null
          roster_period_id: string | null
          starts_at: string
          status: Database["public"]["Enums"]["shift_status"]
          team_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          is_open_shift?: boolean
          notes?: string | null
          organisation_id: string
          overridden_by?: string | null
          override_reason?: string | null
          property_id: string
          published_at?: string | null
          published_by?: string | null
          required_role?: string | null
          required_skill?: string | null
          roster_period_id?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["shift_status"]
          team_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          is_open_shift?: boolean
          notes?: string | null
          organisation_id?: string
          overridden_by?: string | null
          override_reason?: string | null
          property_id?: string
          published_at?: string | null
          published_by?: string | null
          required_role?: string | null
          required_skill?: string | null
          roster_period_id?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["shift_status"]
          team_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_roster_period_id_fkey"
            columns: ["roster_period_id"]
            isOneToOne: false
            referencedRelation: "roster_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_availability: {
        Row: {
          archived_at: string | null
          created_at: string
          day_of_week: number | null
          end_time: string | null
          id: string
          is_available: boolean
          note: string | null
          organisation_id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          specific_date: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["availability_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          day_of_week?: number | null
          end_time?: string | null
          id?: string
          is_available?: boolean
          note?: string | null
          organisation_id: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          specific_date?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["availability_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          day_of_week?: number | null
          end_time?: string | null
          id?: string
          is_available?: boolean
          note?: string | null
          organisation_id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          specific_date?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["availability_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_availability_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          organisation_id: string
          task_id: string
          team_id: string | null
          user_id: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          organisation_id: string
          task_id: string
          team_id?: string | null
          user_id?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          organisation_id?: string
          task_id?: string
          team_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_assignments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          archived_at: string | null
          body: string
          created_at: string
          id: string
          organisation_id: string
          task_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          body: string
          created_at?: string
          id?: string
          organisation_id: string
          task_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          body?: string
          created_at?: string
          id?: string
          organisation_id?: string
          task_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          archived_at: string | null
          before_photo_path: string | null
          category: Database["public"]["Enums"]["task_category"]
          checklist: Json
          completed_at: string | null
          completed_by: string | null
          completion_photo_path: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          id: string
          location: string | null
          organisation_id: string
          parent_task_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          property_id: string
          recurrence_rule: string | null
          status: Database["public"]["Enums"]["task_status"]
          team_id: string | null
          title: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          archived_at?: string | null
          before_photo_path?: string | null
          category?: Database["public"]["Enums"]["task_category"]
          checklist?: Json
          completed_at?: string | null
          completed_by?: string | null
          completion_photo_path?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          location?: string | null
          organisation_id: string
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          property_id: string
          recurrence_rule?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          team_id?: string | null
          title: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          archived_at?: string | null
          before_photo_path?: string | null
          category?: Database["public"]["Enums"]["task_category"]
          checklist?: Json
          completed_at?: string | null
          completed_by?: string | null
          completion_photo_path?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          location?: string | null
          organisation_id?: string
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          property_id?: string
          recurrence_rule?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          team_id?: string | null
          title?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          organisation_id: string
          property_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          organisation_id: string
          property_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          organisation_id?: string
          property_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_adjustment_requests: {
        Row: {
          created_at: string
          explanation: string
          id: string
          manager_note: string | null
          organisation_id: string
          requested_break_minutes: number | null
          requested_date: string | null
          requested_end: string | null
          requested_start: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["adjustment_status"]
          timesheet_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          explanation: string
          id?: string
          manager_note?: string | null
          organisation_id: string
          requested_break_minutes?: number | null
          requested_date?: string | null
          requested_end?: string | null
          requested_start?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["adjustment_status"]
          timesheet_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          explanation?: string
          id?: string
          manager_note?: string | null
          organisation_id?: string
          requested_break_minutes?: number | null
          requested_date?: string | null
          requested_end?: string | null
          requested_start?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["adjustment_status"]
          timesheet_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_adjustment_requests_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_adjustment_requests_timesheet_id_fkey"
            columns: ["timesheet_id"]
            isOneToOne: false
            referencedRelation: "timesheets"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_breaks: {
        Row: {
          created_at: string
          duration_minutes: number | null
          ends_at: string | null
          id: string
          is_paid: boolean
          organisation_id: string
          starts_at: string | null
          timesheet_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_minutes?: number | null
          ends_at?: string | null
          id?: string
          is_paid?: boolean
          organisation_id: string
          starts_at?: string | null
          timesheet_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_minutes?: number | null
          ends_at?: string | null
          id?: string
          is_paid?: boolean
          organisation_id?: string
          starts_at?: string | null
          timesheet_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_breaks_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_breaks_timesheet_id_fkey"
            columns: ["timesheet_id"]
            isOneToOne: false
            referencedRelation: "timesheets"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheets: {
        Row: {
          actual_end: string | null
          actual_start: string | null
          approved_at: string | null
          approved_by: string | null
          break_minutes: number
          created_at: string
          created_by: string | null
          exported_at: string | null
          id: string
          is_no_show: boolean
          locked_at: string | null
          manager_note: string | null
          organisation_id: string
          paid_hours: number | null
          pay_period_end: string | null
          pay_period_start: string | null
          property_id: string
          rostered_end: string | null
          rostered_start: string | null
          shift_id: string | null
          staff_acknowledged_at: string | null
          staff_note: string | null
          status: Database["public"]["Enums"]["timesheet_status"]
          updated_at: string
          user_id: string
          variance_hours: number | null
          work_date: string
        }
        Insert: {
          actual_end?: string | null
          actual_start?: string | null
          approved_at?: string | null
          approved_by?: string | null
          break_minutes?: number
          created_at?: string
          created_by?: string | null
          exported_at?: string | null
          id?: string
          is_no_show?: boolean
          locked_at?: string | null
          manager_note?: string | null
          organisation_id: string
          paid_hours?: number | null
          pay_period_end?: string | null
          pay_period_start?: string | null
          property_id: string
          rostered_end?: string | null
          rostered_start?: string | null
          shift_id?: string | null
          staff_acknowledged_at?: string | null
          staff_note?: string | null
          status?: Database["public"]["Enums"]["timesheet_status"]
          updated_at?: string
          user_id: string
          variance_hours?: number | null
          work_date: string
        }
        Update: {
          actual_end?: string | null
          actual_start?: string | null
          approved_at?: string | null
          approved_by?: string | null
          break_minutes?: number
          created_at?: string
          created_by?: string | null
          exported_at?: string | null
          id?: string
          is_no_show?: boolean
          locked_at?: string | null
          manager_note?: string | null
          organisation_id?: string
          paid_hours?: number | null
          pay_period_end?: string | null
          pay_period_start?: string | null
          property_id?: string
          rostered_end?: string | null
          rostered_start?: string | null
          shift_id?: string | null
          staff_acknowledged_at?: string | null
          staff_note?: string | null
          status?: Database["public"]["Enums"]["timesheet_status"]
          updated_at?: string
          user_id?: string
          variance_hours?: number | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheets_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_property_access: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organisation_id: string
          property_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organisation_id: string
          property_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organisation_id?: string
          property_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_property_access_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_property_access_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organisation_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organisation_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organisation_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      active_uid: { Args: never; Returns: string }
      can_access_property: {
        Args: { target_property_id: string }
        Returns: boolean
      }
      current_organisation_id: { Args: never; Returns: string }
      has_role_at_least: {
        Args: { minimum: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      is_service_context: { Args: never; Returns: boolean }
      manages_property: {
        Args: { target_property_id: string }
        Returns: boolean
      }
      manages_user: { Args: { target_user_id: string }; Returns: boolean }
      redact_sensitive: { Args: { payload: Json }; Returns: Json }
      shares_organisation: {
        Args: { target_user_id: string }
        Returns: boolean
      }
      write_audit_log: {
        Args: {
          p_action: string
          p_after: Json
          p_before: Json
          p_entity_id: string
          p_entity_type: string
          p_organisation_id: string
          p_property_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      acknowledgement_status: "pending" | "viewed" | "accepted" | "declined"
      adjustment_status: "open" | "approved" | "declined"
      announcement_category:
        | "general"
        | "policy"
        | "shift"
        | "safety"
        | "urgent"
      announcement_status:
        | "draft"
        | "scheduled"
        | "published"
        | "expired"
        | "withdrawn"
      app_role: "staff" | "supervisor" | "manager" | "administrator" | "owner"
      availability_status: "pending" | "approved" | "declined"
      clock_event_type: "clock_in" | "break_start" | "break_end" | "clock_out"
      clock_source: "app" | "kiosk" | "manager_entry"
      clocking_mode:
        | "any_device"
        | "registered_devices"
        | "kiosk"
        | "geofence"
        | "manager_entry"
      employment_status: "active" | "on_leave" | "suspended" | "ended"
      employment_type: "full_time" | "part_time" | "casual" | "contractor"
      leave_category:
        | "annual"
        | "personal"
        | "carers"
        | "unpaid"
        | "parental"
        | "compassionate"
        | "long_service"
        | "community_service"
        | "other"
      leave_status: "pending" | "approved" | "declined" | "cancelled"
      notification_category:
        | "roster_published"
        | "shift_changed"
        | "shift_cancelled"
        | "shift_ack_reminder"
        | "open_shift"
        | "replacement_update"
        | "leave_update"
        | "timesheet_correction"
        | "timesheet_approval_reminder"
        | "announcement"
        | "urgent_notice"
        | "task_assigned"
        | "task_due"
        | "document_ack"
      pay_period_type: "weekly" | "fortnightly"
      replacement_status:
        | "requested"
        | "offered"
        | "claimed"
        | "approved"
        | "rejected"
        | "withdrawn"
      roster_status: "draft" | "published" | "archived"
      shift_status: "draft" | "published" | "cancelled"
      task_category:
        | "housekeeping"
        | "reception"
        | "maintenance"
        | "grounds"
        | "linen"
        | "stock"
        | "safety"
        | "management"
        | "other"
      task_priority: "low" | "normal" | "high" | "urgent"
      task_status:
        | "new"
        | "assigned"
        | "in_progress"
        | "waiting"
        | "completed"
        | "verified"
        | "cancelled"
      timesheet_status:
        | "draft"
        | "staff_review_requested"
        | "submitted"
        | "manager_review"
        | "approved"
        | "exported"
        | "locked"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      acknowledgement_status: ["pending", "viewed", "accepted", "declined"],
      adjustment_status: ["open", "approved", "declined"],
      announcement_category: ["general", "policy", "shift", "safety", "urgent"],
      announcement_status: [
        "draft",
        "scheduled",
        "published",
        "expired",
        "withdrawn",
      ],
      app_role: ["staff", "supervisor", "manager", "administrator", "owner"],
      availability_status: ["pending", "approved", "declined"],
      clock_event_type: ["clock_in", "break_start", "break_end", "clock_out"],
      clock_source: ["app", "kiosk", "manager_entry"],
      clocking_mode: [
        "any_device",
        "registered_devices",
        "kiosk",
        "geofence",
        "manager_entry",
      ],
      employment_status: ["active", "on_leave", "suspended", "ended"],
      employment_type: ["full_time", "part_time", "casual", "contractor"],
      leave_category: [
        "annual",
        "personal",
        "carers",
        "unpaid",
        "parental",
        "compassionate",
        "long_service",
        "community_service",
        "other",
      ],
      leave_status: ["pending", "approved", "declined", "cancelled"],
      notification_category: [
        "roster_published",
        "shift_changed",
        "shift_cancelled",
        "shift_ack_reminder",
        "open_shift",
        "replacement_update",
        "leave_update",
        "timesheet_correction",
        "timesheet_approval_reminder",
        "announcement",
        "urgent_notice",
        "task_assigned",
        "task_due",
        "document_ack",
      ],
      pay_period_type: ["weekly", "fortnightly"],
      replacement_status: [
        "requested",
        "offered",
        "claimed",
        "approved",
        "rejected",
        "withdrawn",
      ],
      roster_status: ["draft", "published", "archived"],
      shift_status: ["draft", "published", "cancelled"],
      task_category: [
        "housekeeping",
        "reception",
        "maintenance",
        "grounds",
        "linen",
        "stock",
        "safety",
        "management",
        "other",
      ],
      task_priority: ["low", "normal", "high", "urgent"],
      task_status: [
        "new",
        "assigned",
        "in_progress",
        "waiting",
        "completed",
        "verified",
        "cancelled",
      ],
      timesheet_status: [
        "draft",
        "staff_review_requested",
        "submitted",
        "manager_review",
        "approved",
        "exported",
        "locked",
      ],
    },
  },
} as const

