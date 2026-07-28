"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Open the browser's print dialog for the print-optimised roster view. */
export function PrintRosterButton() {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => window.print()}
      data-print-hide
    >
      <Printer className="h-4 w-4" aria-hidden="true" />
      Print roster
    </Button>
  );
}
