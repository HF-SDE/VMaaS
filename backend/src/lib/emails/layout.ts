/**
 * Minimal, table-free HTML shell shared by every transactional email.
 * Inline styles only — Gmail and Outlook drop <style> blocks.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Tenant names, role names and user names all reach these templates from the
 *  database, so every interpolation is escaped. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character]!);
}

export type EmailButton = { label: string; url: string };

export function renderLayout({
  heading,
  body,
  button,
  footer,
}: {
  heading: string;
  body: string;
  button?: EmailButton;
  footer?: string;
}): string {
  const buttonHtml = button
    ? `<p style="margin:32px 0;">
         <a href="${escapeHtml(button.url)}"
            style="background:#111827;border-radius:6px;color:#ffffff;display:inline-block;font-weight:600;padding:12px 24px;text-decoration:none;">
           ${escapeHtml(button.label)}
         </a>
       </p>
       <p style="color:#6b7280;font-size:13px;line-height:20px;margin:0 0 8px;">
         If the button does not work, paste this into your browser:
       </p>
       <p style="color:#6b7280;font-size:13px;line-height:20px;margin:0;word-break:break-all;">
         ${escapeHtml(button.url)}
       </p>`
    : "";

  const footerHtml = footer
    ? `<p style="border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;line-height:20px;margin:32px 0 0;padding-top:16px;">
         ${footer}
       </p>`
    : "";

  return `<!doctype html>
<html>
  <body style="background:#f9fafb;margin:0;padding:24px;">
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;color:#111827;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0 auto;max-width:560px;padding:32px;">
      <p style="color:#6b7280;font-size:13px;font-weight:600;letter-spacing:0.08em;margin:0 0 24px;text-transform:uppercase;">VMaaS</p>
      <h1 style="font-size:20px;line-height:28px;margin:0 0 16px;">${escapeHtml(heading)}</h1>
      ${body}
      ${buttonHtml}
      ${footerHtml}
    </div>
  </body>
</html>`;
}
