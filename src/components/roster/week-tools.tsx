"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  applyTemplate,
  copyWeek,
  saveWeekAsTemplate,
  type TemplateActionState,
} from "@/lib/roster/template-actions";
import type { RosterProperty } from "@/lib/roster/manager-queries";
import { formatWeekLabel, shiftWeek } from "@/lib/roster/week";

function Pending({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

/** Success and warning render together — a copy can land and still need a note. */
function Result({ state }: { state: TemplateActionState }) {
  return (
    <>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.success && <Alert tone="success">{state.success}</Alert>}
      {state.warning && <Alert tone="warning">{state.warning}</Alert>}
    </>
  );
}

type Tool = null | "copy" | "save" | "apply";

/**
 * Week-level tools: duplicate a week, save it as a template, apply one.
 *
 * All three produce DRAFT shifts. Duplicating a published week must not
 * publish the copy, or staff would be notified about a roster the manager
 * has not finished building.
 */
export function WeekTools({
  weekStartDate,
  properties,
  templates,
}: {
  weekStartDate: string;
  properties: RosterProperty[];
  templates: { id: string; name: string; propertyId: string }[];
}) {
  const [tool, setTool] = useState<Tool>(null);
  const [copyState, copyAction] = useActionState<TemplateActionState, FormData>(
    copyWeek,
    {},
  );
  const [saveState, saveAction] = useActionState<TemplateActionState, FormData>(
    saveWeekAsTemplate,
    {},
  );
  const [applyState, applyAction] = useActionState<
    TemplateActionState,
    FormData
  >(applyTemplate, {});

  const propertySelect = (id: string) => (
    <Field label="Property" htmlFor={id}>
      <select
        id={id}
        name="propertyId"
        required
        defaultValue={properties[0]?.id}
        className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <section
      aria-labelledby="week-tools-heading"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2
        id="week-tools-heading"
        className="text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        Week tools
      </h2>

      <div className="mt-3 space-y-3">
        <Result state={copyState} />
        <Result state={saveState} />
        <Result state={applyState} />
      </div>

      {tool === null && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setTool("copy")}>
            Copy this week to another
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTool("save")}>
            Save as template
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={templates.length === 0}
            onClick={() => setTool("apply")}
          >
            {templates.length === 0
              ? "No templates saved yet"
              : "Apply a template"}
          </Button>
        </div>
      )}

      {tool === "copy" && (
        <form action={copyAction} className="mt-4 space-y-4">
          <input type="hidden" name="sourceWeek" value={weekStartDate} />
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Copying <strong>{formatWeekLabel(weekStartDate)}</strong>. The copy
            arrives as a draft, so nobody is notified until you publish it.
          </p>
          {propertySelect("copy-property")}
          <Field
            label="Copy into the week beginning"
            htmlFor="copy-target"
            hint="Must be a Monday, and that week must have no shifts yet."
          >
            <Input
              id="copy-target"
              name="targetWeek"
              type="date"
              required
              defaultValue={shiftWeek(weekStartDate, 1)}
            />
          </Field>
          <div className="flex gap-2">
            <Pending label="Copy week" />
            <Button variant="ghost" size="sm" onClick={() => setTool(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {tool === "save" && (
        <form action={saveAction} className="mt-4 space-y-4">
          <input type="hidden" name="weekStartDate" value={weekStartDate} />
          {propertySelect("save-property")}
          <Field
            label="Template name"
            htmlFor="save-name"
            hint="Something you will recognise later, such as “Summer weekday”."
          >
            <Input
              id="save-name"
              name="name"
              required
              minLength={2}
              maxLength={100}
              placeholder="Peak season — full housekeeping"
            />
          </Field>
          <div className="flex gap-2">
            <Pending label="Save template" />
            <Button variant="ghost" size="sm" onClick={() => setTool(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {tool === "apply" && (
        <form action={applyAction} className="mt-4 space-y-4">
          <input type="hidden" name="targetWeek" value={weekStartDate} />
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Applying to <strong>{formatWeekLabel(weekStartDate)}</strong>, which
            must have no shifts yet.
          </p>
          <Field label="Template" htmlFor="apply-template">
            <select
              id="apply-template"
              name="templateId"
              required
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex gap-2">
            <Pending label="Apply template" />
            <Button variant="ghost" size="sm" onClick={() => setTool(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
