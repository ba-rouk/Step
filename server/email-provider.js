function parseFrom(value) {
  const input = String(value || "").trim();
  const match = input.match(/^(.*?)\s*<([^<>]+)>$/);
  return match ? { name: match[1].replace(/^["']|["']$/g, ""), email: match[2] } : { name: "Step Town", email: input };
}

async function request(url, headers, body) {
  const response = await fetch(url, {
    method: "POST", headers, body, signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Email provider returned ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

export async function sendProviderEmail({ to, subject, html, text }) {
  const provider = String(process.env.EMAIL_PROVIDER || "resend").toLowerCase();
  const key = String(process.env.EMAIL_API_KEY || process.env.RESEND_API_KEY || "");
  const from = String(process.env.EMAIL_FROM || "");
  if (!key || !from) throw new Error("EMAIL_API_KEY and EMAIL_FROM must be configured before email delivery.");
  if (!/^\S+@\S+\.\S+$/.test(String(to || ""))) throw new Error("The email recipient is invalid.");
  const fromParts = parseFrom(from);
  const replyTo = String(process.env.EMAIL_REPLY_TO || "");

  if (provider === "resend") {
    return request("https://api.resend.com/emails", {
      Authorization: "Bearer " + key, "Content-Type": "application/json"
    }, JSON.stringify({ from, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }));
  }
  if (provider === "brevo") {
    return request("https://api.brevo.com/v3/smtp/email", {
      "api-key": key, "Content-Type": "application/json"
    }, JSON.stringify({ sender: fromParts, to: [{ email: to }], subject, htmlContent: html, textContent: text, ...(replyTo ? { replyTo: { email: replyTo } } : {}) }));
  }
  if (provider === "postmark") {
    return request("https://api.postmarkapp.com/email", {
      "X-Postmark-Server-Token": key, "Content-Type": "application/json"
    }, JSON.stringify({ From: from, To: to, Subject: subject, HtmlBody: html, TextBody: text, ...(replyTo ? { ReplyTo: replyTo } : {}) }));
  }
  if (provider === "sendgrid") {
    return request("https://api.sendgrid.com/v3/mail/send", {
      Authorization: "Bearer " + key, "Content-Type": "application/json"
    }, JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromParts.email, name: fromParts.name },
      ...(replyTo ? { reply_to: { email: replyTo } } : {}),
      subject, content: [{ type: "text/plain", value: text }, { type: "text/html", value: html }]
    }));
  }
  if (provider === "mailgun") {
    const domain = String(process.env.MAILGUN_DOMAIN || fromParts.email.split("@")[1] || "");
    const form = new URLSearchParams({ from, to, subject, text, html });
    if (replyTo) form.set("h:Reply-To", replyTo);
    return request(`https://api.mailgun.net/v3/${encodeURIComponent(domain)}/messages`, {
      Authorization: "Basic " + Buffer.from("api:" + key).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    }, form);
  }
  throw new Error("EMAIL_PROVIDER must be resend, brevo, postmark, mailgun or sendgrid.");
}
