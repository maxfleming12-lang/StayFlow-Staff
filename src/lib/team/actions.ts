"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import type { Database } from "@/types/database";

type AppRole = Database["public"]["Enums"]["app_role"];

export interface TeamActionState {
  error?: string;
  success?: string;
  /** Shown once, immediately after creating an account. Never retrievable. */
  temporaryPassword?: string;
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  firstName: z.string().trim().min(1, "Enter their first name.").max(100),
  lastName: z.string().trim().min(1, "Enter their last name.").max(100),
  preferredName: z.string().trim().max(100).optional(),
  jobTitle: z.string().trim().max(100).optional(),
  mobile: z.string().trim().max(30).optional(),
  role: z.enum(["staff", "supervisor", "manager", "administrator"]),
  propertyIds: z.array(z.string().uuid()).min(1, "Choose at least one property."),
});

/**
 * Create a staff account.
 *
 * Uses a temporary password rather than an emailed invite, deliberately: a
 * motel manager is usually standing next to the person they are onboarding,
 * and requiring working SMTP to add a casual on a Saturday morning is how a
 * system stops being used. The password is shown once and never stored
 * retrievably — the same pattern as kiosk PINs.
 *
 * The owner role is not offerable here. Granting it is guarded in the
 * database (`guard_role_change`) and is a decision that should be made
 * deliberately, not through a staff-onboarding form.
 */
export async function inviteStaff(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const actor = await requireRole("administrator");

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    preferredName: (formData.get("preferredName") as string) || undefined,
    jobTitle: (formData.get("jobTitle") as string) || undefined,
    mobile: (formData.get("mobile") as string) || undefined,
    role: formData.get("role"),
    propertyIds: formData.getAll("propertyIds").map(String).filter(Boolean),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const input = parsed.data;

  // Long enough that it is not worth guessing in the window before the
  // person signs in and changes it.
  const temporaryPassword = randomBytes(9).toString("base64url");

  let createdUserId: string | null = null;

  try {
    const admin = createServiceRoleClient();

    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email: input.email,
      password: temporaryPassword,
      email_confirm: true,
    });

    if (authError || !created?.user) {
      const message = authError?.message ?? "";
      if (/already|registered|exists/i.test(message)) {
        return { error: "Someone already has an account with that email." };
      }
      return { error: `Could not create the account: ${message}` };
    }

    createdUserId = created.user.id;

    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id,
      organisation_id: actor.organisationId,
      legal_first_name: input.firstName,
      legal_last_name: input.lastName,
      preferred_name: input.preferredName ?? null,
      email: input.email,
      mobile_number: input.mobile ?? null,
      job_title: input.jobTitle ?? null,
      primary_property_id: input.propertyIds[0],
      is_active: true,
    });

    if (profileError) {
      // Roll the auth user back by hand. Without this an orphaned login
      // exists that can sign in but has no profile, and the email is then
      // permanently unusable for a second attempt.
      await admin.auth.admin.deleteUser(created.user.id);
      return { error: `Could not create the profile: ${profileError.message}` };
    }

    const { error: roleError } = await admin.from("user_roles").insert({
      organisation_id: actor.organisationId,
      user_id: created.user.id,
      role: input.role as AppRole,
    });

    if (roleError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return { error: `Could not set their role: ${roleError.message}` };
    }

    const { error: accessError } = await admin
      .from("user_property_access")
      .insert(
        input.propertyIds.map((propertyId) => ({
          organisation_id: actor.organisationId,
          user_id: created.user.id,
          property_id: propertyId,
        })),
      );

    if (accessError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return { error: `Could not assign properties: ${accessError.message}` };
    }
  } catch (error) {
    if (createdUserId) {
      try {
        createServiceRoleClient().auth.admin.deleteUser(createdUserId);
      } catch {
        // Nothing more to do; reported below either way.
      }
    }
    return {
      error:
        error instanceof Error
          ? `Could not finish setting up the account: ${error.message}`
          : "Cannot reach StayFlow right now.",
    };
  }

  revalidatePath("/team");
  return {
    success: `${input.preferredName || input.firstName} can now sign in.`,
    temporaryPassword,
  };
}

const statusSchema = z.object({
  userId: z.string().uuid(),
  isActive: z.boolean(),
});

/**
 * Turn an account on or off.
 *
 * Deactivating is the correct way to handle someone leaving: `active_uid()`
 * returns nothing for them immediately, so every self-scoped policy stops
 * matching, while their roster and attendance history stay intact for
 * payroll and record-keeping. Deleting would destroy exactly the records an
 * employer needs to retain.
 */
export async function setStaffActive(
  userId: string,
  isActive: boolean,
): Promise<TeamActionState> {
  await requireRole("administrator");

  const parsed = statusSchema.safeParse({ userId, isActive });
  if (!parsed.success) return { error: "That person could not be identified." };

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ is_active: parsed.data.isActive })
      .eq("id", parsed.data.userId);

    // guard_owner_profile raises rather than matching zero rows when
    // somebody tries to deactivate the organisation owner.
    if (error) return { error: error.message };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }

  revalidatePath("/team");
  return {
    success: isActive
      ? "Account reactivated."
      : "Account deactivated. They lose access immediately; their records are kept.",
  };
}

/** Send a password reset so somebody can set their own. */
export async function sendPasswordReset(
  email: string,
): Promise<TeamActionState> {
  await requireRole("administrator");

  try {
    const { siteUrl } = await import("@/lib/supabase/env");
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl()}/auth/callback?next=/reset-password`,
    });
    if (error) return { error: "Could not send that reset email." };
  } catch {
    return { error: "Cannot reach StayFlow right now." };
  }

  return {
    success: `Reset email sent to ${email}, if that address has an account.`,
  };
}
