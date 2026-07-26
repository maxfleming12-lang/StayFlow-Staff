"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { requestPasswordReset, type AuthFormState } from "@/lib/auth/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" full disabled={pending} aria-busy={pending}>
      {pending ? "Sending…" : "Email me a reset link"}
    </Button>
  );
}

/**
 * Password reset request form.
 *
 * On success the form is replaced by the confirmation notice, because
 * re-submitting achieves nothing and repeated presses only cause confusion.
 */
export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(
    requestPasswordReset,
    {},
  );

  if (state.success) {
    return (
      <div className="mt-6">
        <Alert tone="success" title="Check your email">
          {state.success}
        </Alert>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-6 space-y-4" noValidate>
      {state.error && <Alert tone="error">{state.error}</Alert>}

      <Field label="Email address" htmlFor="email" error={state.fieldErrors?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          required
          aria-invalid={Boolean(state.fieldErrors?.email)}
          placeholder="you@example.com.au"
        />
      </Field>

      <SubmitButton />
    </form>
  );
}
