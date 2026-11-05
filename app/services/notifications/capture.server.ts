import { randomUUID } from "node:crypto";
import type { EmailProvider, EmailSendRequest, EmailSendResult } from "./types";

// A non-sending EmailProvider, selected with EMAIL_PROVIDER=capture.
//
// Purpose: exercise the real review-request scheduling and dispatch path end to end — the
// sweeps, the pre-send claim, the reminder fields, suppression, the retry/rollback behaviour —
// without putting a single message on the wire. Every send is recorded in process so a test or
// harness can assert on exactly what WOULD have been delivered: recipient, subject, sender
// identity, Reply-To, tags, and the rendered HTML and text.
//
// This is deliberately a provider rather than a mock of review-request.server.ts. Mocking the
// dispatch layer skips the part most worth testing: the real template rendering and the real
// terminal database writes that follow a send. Swapping the vendor at the one seam that already
// exists (provider.server.ts's EMAIL_PROVIDER switch) keeps every other line of the production
// path genuinely under test.
//
// Never reachable in production by accident: EMAIL_PROVIDER is unset there, which
// provider.server.ts resolves to "resend".

export interface CapturedEmail extends EmailSendRequest {
  id: string;
  capturedAt: Date;
}

// Module-level, so a harness that imports this module sees what the dispatch path sent. Scoped
// to one process; nothing is persisted.
const captured: CapturedEmail[] = [];

export function getCapturedEmails(): readonly CapturedEmail[] {
  return captured;
}

export function clearCapturedEmails(): void {
  captured.length = 0;
}

/** Every captured send addressed to one recipient, oldest first. */
export function capturedEmailsTo(recipient: string): CapturedEmail[] {
  const needle = recipient.trim().toLowerCase();
  return captured.filter((email) => email.to.trim().toLowerCase() === needle);
}

export function createCaptureEmailProvider(): EmailProvider {
  return {
    name: "capture",
    async sendEmail(request: EmailSendRequest): Promise<EmailSendResult> {
      const id = `captured_${randomUUID()}`;
      captured.push({ ...request, id, capturedAt: new Date() });

      // One compact line per send, so a harness run is readable as it happens without dumping
      // a full HTML body into the terminal.
      const emailType = request.tags?.email_type ?? "initial";
      console.log(`[capture] -> ${request.to} | ${emailType} | from "${request.fromName ?? "(default)"}" | ${request.subject}`);

      return { id };
    },
  };
}
