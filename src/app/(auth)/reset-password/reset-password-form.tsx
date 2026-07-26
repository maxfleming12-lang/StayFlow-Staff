"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { updatePassword, type AuthFormState } from "@/lib/auth/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" full disabled={pending} aria-busy={pending}>
      {pending ? "Saving…" : "Save new password"}
    </Button>
  );
}

/** Form for setting a new password during account recovery. */
export function ResetPasswordForm() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(
    updatePassword,
    {},
  );

  return (
    <form action={formAction} className="mt-6 space-y-4" noValidate>
      {state.error && <Alert tone="error">{state.error}</Alert>}

      <Field
        label="New password"
        htmlFor="password"
        hint="At least 12 characters. A short phrase you will remember works well."
        error={state.fieldErrors?.password}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          aria-invalid={Boolean(state.fieldErrors?.password)}
        />
      </Field>

      <Field
        label="Confirm new password"
        htmlFor="confirmPassword"
        error={state.fieldErrors?.confirmPassword}
      >
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
        />
      </Field>

      <SubmitButton />
    </form>
  );
}
