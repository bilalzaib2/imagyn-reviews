export interface EmailSendRequest {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSendResult {
  id: string;
}

// Every channel (Email today; SMS/WhatsApp later) gets its own narrow provider interface
// here rather than one unified send(message) shape — an email needs subject/html/text, an
// SMS needs a phone number and a text body, and forcing those through one signature would
// leak one channel's concerns into another's. review-request.server.ts, the only caller,
// depends on EmailProvider and never on a specific vendor's request format — that's what
// makes switching vendors a config change (EMAIL_PROVIDER env var) instead of a code change.
// UI components never import from this directory at all. Mirrors app/services/ai/types.ts.
export interface EmailProvider {
  readonly name: string;
  sendEmail(request: EmailSendRequest): Promise<EmailSendResult>;
}

export class NotificationProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
  ) {
    super(message);
    this.name = "NotificationProviderError";
  }
}
