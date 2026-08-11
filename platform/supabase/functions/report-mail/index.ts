// ============================================================
// report-mail — puts a filed report in front of a human.
//
// Called by Postgres (pg_net) from report_notify(), never by a browser.
// Body: { report: { id, reason, note, created_at, target, target_id,
//                   reporter_handle, reporter_id, author_handle,
//                   author_id, excerpt, link } }
//
// `reports` rows have been piling up in a table nobody opens since step
// 1.7. The moderation promise the sheet makes — "a person reads every
// report" — is only true if a person is told, so every insert now
// becomes one email to the address on the website.
//
// Delivery is Resend, because it is one HTTPS POST with an API key and
// needs no SMTP credentials in the function. Swapping providers means
// changing `send()` and nothing else.
//
// Secrets (supabase secrets set …):
//   RESEND_API_KEY     the provider key. Without it this function logs
//                      the report and returns 200 — a report must never
//                      fail to file because the mailer is misconfigured.
//   REPORT_MAIL_FROM   defaults to "Crema <reports@crema-app.com>". Must
//                      be a domain verified with Resend or every send
//                      403s.
//   REPORT_MAIL_TO     defaults to hello@crema-app.com.
//   PUSH_HOOK_SECRET   shared with Postgres (vault: push_secret). This
//                      function is deployed --no-verify-jwt so pg_net
//                      can reach it, so the header check below is the
//                      ONLY thing between it and the open internet. It
//                      is deliberately the same secret send-push uses:
//                      Supabase secrets are per project, both callers
//                      are the same Postgres, and a second secret would
//                      be a second thing to rotate for no more safety.
// ============================================================
const HOOK_SECRET = Deno.env.get("PUSH_HOOK_SECRET") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const MAIL_FROM = Deno.env.get("REPORT_MAIL_FROM") ?? "Crema <reports@crema-app.com>";
const MAIL_TO = Deno.env.get("REPORT_MAIL_TO") ?? "hello@crema-app.com";

type Report = {
  id?: string;
  reason?: string;
  note?: string | null;
  created_at?: string;
  target?: string;            // 'post' | 'comment' | 'user'
  target_id?: string;
  reporter_id?: string;
  reporter_handle?: string | null;
  author_id?: string | null;
  author_handle?: string | null;
  excerpt?: string | null;    // caption or comment body, trimmed by the trigger
  link?: string | null;       // deep link into the app, when the target has one
};

// Length is checked first so a wrong-length guess costs one comparison
// rather than leaking where the two strings diverge.
function secretOk(given: string): boolean {
  if (!HOOK_SECRET || given.length !== HOOK_SECRET.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ HOOK_SECRET.charCodeAt(i);
  return diff === 0;
}

const who = (handle?: string | null, id?: string | null) =>
  handle ? `@${handle} (${id ?? "?"})` : (id ?? "unknown");

function plain(r: Report): string {
  const lines = [
    `A ${r.target ?? "post"} was reported on Crema.`,
    ``,
    `Reason      ${r.reason ?? "—"}`,
    `Reported by ${who(r.reporter_handle, r.reporter_id)}`,
    `Target      ${r.target ?? "post"} ${r.target_id ?? "—"}`,
  ];
  if (r.author_id) lines.push(`Author      ${who(r.author_handle, r.author_id)}`);
  if (r.excerpt) lines.push(`Content     ${r.excerpt}`);
  if (r.note) lines.push(`Note        ${r.note}`);
  if (r.link) lines.push(`Open        ${r.link}`);
  lines.push(
    `Filed       ${r.created_at ?? new Date().toISOString()}`,
    `Report id   ${r.id ?? "—"}`,
    ``,
    `Resolve it in the reports table:`,
    `  update reports set status = 'reviewed' where id = '${r.id ?? ""}';`,
    `(status: open | reviewed | actioned | dismissed)`,
  );
  return lines.join("\n");
}

async function send(r: Report): Promise<Response> {
  // No key is a configuration state, not a request error: answering
  // anything but 200 would only fill pg_net's log with failures that the
  // trigger cannot see and cannot act on anyway.
  if (!RESEND_KEY) {
    console.warn("RESEND_API_KEY unset — report not emailed:", JSON.stringify(r));
    return new Response(JSON.stringify({ ok: true, mailed: false }), { status: 200 });
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [MAIL_TO],
      // The reason rides in the subject so the inbox is triageable
      // without opening anything.
      subject: `Crema report — ${r.reason ?? "unspecified"} (${r.target ?? "post"})`,
      text: plain(r),
      // Replies go to a person, not to the report robot.
      reply_to: MAIL_TO,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`resend ${res.status}: ${body}`);
    return new Response(JSON.stringify({ ok: false, status: res.status }), { status: 502 });
  }
  return new Response(JSON.stringify({ ok: true, mailed: true }), { status: 200 });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!secretOk(req.headers.get("X-Push-Secret") ?? "")) return new Response("forbidden", { status: 403 });

  let body: { report?: Report };
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  const r = body?.report;
  if (!r || typeof r !== "object") return new Response("no report", { status: 400 });

  try {
    return await send(r);
  } catch (e) {
    console.error("report-mail failed", e);
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }
});
