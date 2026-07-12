const MAILHOG = process.env.MAILHOG_URL ?? 'http://localhost:8025';

interface MailhogMessage {
  Content: { Headers: Record<string, string[]>; Body: string };
}

/** Poll mailhog until a message with `subject` arrives, or time out. */
export async function waitForEmail(subject: string, timeoutMs = 15_000): Promise<MailhogMessage> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(`${MAILHOG}/api/v2/messages`);
    if (res.ok) {
      const data = (await res.json()) as { items: MailhogMessage[] };
      const hit = data.items.find((m) =>
        (m.Content.Headers.Subject ?? []).some((s) => s.includes(subject)),
      );
      if (hit) return hit;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(`No email with subject containing "${subject}" arrived within ${timeoutMs}ms`);
}

/** Pull the first URL out of a mail body (password reset, invite accept). */
export function extractLink(email: MailhogMessage, textIncludes?: string): string {
  const body = email.Content.Body.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
  const urls = body.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
  const hit = textIncludes ? urls.find((u) => u.includes(textIncludes)) : urls[0];
  if (!hit)
    throw new Error(`No link${textIncludes ? ` containing "${textIncludes}"` : ''} in email body`);
  return hit;
}

export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILHOG}/api/v1/messages`, { method: 'DELETE' }).catch(() => {});
}
