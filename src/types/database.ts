/**
 * Database types for StayFlow Staff.
 *
 * This file covers the identity-and-access core created by migration 0001.
 * The remaining operational tables (rosters, shifts, timesheets, leave,
 * tasks, documents, notifications) arrive with the full schema migration.
 *
 * Regenerate against a live project with:
 *   npx supabase gen types typescript --linked > src/types/database.ts
 *
 * Keep this file in sync with supabase/migrations — the compiler is the only
 * thing standing between a renamed column and a runtime failure.
 */

/** Values a JSON/JSONB column may hold. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** Role identifiers, mirroring the `app_role` Postgres enum. */
export type AppRole =
  | "staff"
  | "supervisor"
  | "manager"
  | "administrator"
  | "owner";

/** Employment status, mirroring the `employment_status` enum. */
export type EmploymentStatus = "active" | "on_leave" | "suspended" | "ended";

/** Employment type, mirroring the `employment_type` enum. */
export type EmploymentType =
  | "full_time"
  | "part_time"
  | "casual"
  | "contractor";

export interface Database {
  public: {
    Tables: {
      organisations: {
        Row: {
          id: string;
          name: string;
          legal_name: string | null;
          timezone: string;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          legal_name?: string | null;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          legal_name?: string | null;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      properties: {
        Row: {
          id: string;
          organisation_id: string;
          name: string;
          short_code: string;
          address: string | null;
          timezone: string;
          colour: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          created_by: string | null;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          organisation_id: string;
          name: string;
          short_code: string;
          address?: string | null;
          timezone?: string;
          colour?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
          archived_at?: string | null;
        };
        Update: {
          id?: string;
          organisation_id?: string;
          name?: string;
          short_code?: string;
          address?: string | null;
          timezone?: string;
          colour?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          organisation_id: string;
          preferred_name: string | null;
          legal_first_name: string;
          legal_last_name: string;
          email: string;
          mobile_number: string | null;
          job_title: string | null;
          primary_property_id: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          created_by: string | null;
          archived_at: string | null;
        };
        Insert: {
          id: string;
          organisation_id: string;
          preferred_name?: string | null;
          legal_first_name: string;
          legal_last_name: string;
          email: string;
          mobile_number?: string | null;
          job_title?: string | null;
          primary_property_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
          archived_at?: string | null;
        };
        Update: {
          id?: string;
          organisation_id?: string;
          preferred_name?: string | null;
          legal_first_name?: string;
          legal_last_name?: string;
          email?: string;
          mobile_number?: string | null;
          job_title?: string | null;
          primary_property_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          id: string;
          organisation_id: string;
          user_id: string;
          role: AppRole;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          organisation_id: string;
          user_id: string;
          role: AppRole;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          organisation_id?: string;
          user_id?: string;
          role?: AppRole;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      user_property_access: {
        Row: {
          id: string;
          organisation_id: string;
          user_id: string;
          property_id: string;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          organisation_id: string;
          user_id: string;
          property_id: string;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          organisation_id?: string;
          user_id?: string;
          property_id?: string;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          organisation_id: string;
          property_id: string | null;
          actor_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          before_value: Json | null;
          after_value: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organisation_id: string;
          property_id?: string | null;
          actor_id?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          before_value?: Json | null;
          after_value?: Json | null;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      /** Organisation of the calling user; SECURITY DEFINER. */
      current_organisation_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      /** True when the caller holds at least the given role. */
      has_role_at_least: {
        Args: { minimum: AppRole };
        Returns: boolean;
      };
      /** True when the caller may access the given property. */
      can_access_property: {
        Args: { target_property_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: AppRole;
      employment_status: EmploymentStatus;
      employment_type: EmploymentType;
    };
  };
}
