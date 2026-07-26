"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/supabase/env";
import { safeRedirectPath } from "@/lib/safe-redirect";

/** Shape returned by every auth action to its form. */
export interface AuthFormState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
}

const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .email("Enter a valid email address.");

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

/**
 * Sign in with email and password.
 *
 * Authentication failures return one deliberately vague message. Saying
 * "no account with that email" would let an outsider enumerate which
 * addresses are registered staff.
 */
export async function signIn(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // Only the network calls are wrapped. redirect() below signals success by
  // throwing NEXT_REDIRECT internally, so it must stay outside any catch.
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error) {
      return { error: "Those details do not match an active account." };
    }

    // A user may authenticate yet still be denied: deactivated, archived, or
    // never provisioned with a profile. Check before letting them through.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_active, archived_at")
        .eq("id", user.id)
        .maybeSingle();

      if (!profile || !profile.is_active || profile.archived_at) {
        await supabase.auth.signOut();
        return {
          error: "Your account is not active. Please contact your manager.",
        };
      }
    }
  } catch {
    // Supabase unreachable, misconfigured, or timing out. Staff should see
    // something actionable rather than a crashed screen mid-shift.
    return {
      error:
        "Cannot reach StayFlow right now. Check your connection and try again.",
    };
  }

  const next = safeRedirectPath(formData.get("next"));
  revalidatePath("/", "layout");
  redirect(next);
}

/**
 * Send a password reset email.
 *
 * Always reports success, whether or not the address belongs to an account.
 * Reporting "unknown address" would disclose who works here.
 */
export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));

  if (!parsed.success) {
    return { fieldErrors: { email: parsed.error.issues[0].message } };
  }

  try {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${siteUrl()}/auth/callback?next=/reset-password`,
    });
  } catch {
    return {
      error:
        "Cannot reach StayFlow right now. Check your connection and try again.",
    };
  }

  return {
    success:
      "If that address belongs to a StayFlow account, a reset link is on its way. Check your inbox and spam folder.",
  };
}

const updatePasswordSchema = z
  .object({
    password: z
      .string()
      .min(12, "Use at least 12 characters.")
      .max(72, "Passwords cannot exceed 72 characters."),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Both passwords must match.",
  });

/**
 * Set a new password for the user holding the current recovery session.
 *
 * Requires an already-established session, created by following the emailed
 * link through /auth/callback. Without one, there is nothing to update.
 */
export async function updatePassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        error:
          "This reset link has expired. Request a new one from the sign-in screen.",
      };
    }

    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });

    if (error) {
      return { error: error.message };
    }
  } catch {
    return {
      error:
        "Cannot reach StayFlow right now. Check your connection and try again.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/?passwordUpdated=1");
}

/** Sign the current user out and return them to the login screen. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/** Flatten a Zod error into `{ field: firstMessage }`. */
function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
