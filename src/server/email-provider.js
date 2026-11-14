import { Buffer } from "node:buffer";

const required = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(name + " is not configured.");
  return value;
};
const sender = () => ({
  email:required("EMAIL_FROM"),
  name:String(process.env.EMAIL_FROM_NAME || "Step Town").trim()
});
const fromLine = () => {
  const s = sender();
  return s.name + " <" + s.email + ">";
};

export async function sendEmail({ to, subject, html, text }) {
  const provider = String(process.env.EMAIL_PROVIDER || "resend").toLowerCase();
  const apiKey = required("EMAIL_API_KEY");
  const recipient = String(process.env.EMAIL_SANDBOX || "false").toLowerCase() === "true"
    ? required("EMAIL_SANDBOX_TO") : to;
  const timeout = AbortSignal.timeout(15000);
  let response;

  if (provider === "resend") {
    response = await fetch("https://api.resend.com/emails", {
      method:"POST", signal:timeout,
      headers:{ Authorization:"Bearer " + apiKey, "Content-Type":"application/json" },
      body:JSON.stringify({ from:fromLine(), to:[recipient], subject, html, text })
    });
  } else if (provider === "brevo") {
    response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method:"POST", signal:timeout,
      headers:{ "api-key":apiKey, "Content-Type":"application/json" },
      body:JSON.stringify({ sender:sender(), to:[{email:recipient}], subject, htmlContent:html, textContent:text })
    });
  } else if (provider === "postmark") {
    response = await fetch("https://api.postmarkapp.com/email", {
      method:"POST", signal:timeout,
      headers:{ "X-Postmark-Server-Token":apiKey, "Content-Type":"application/json" },
      body:JSON.stringify({ From:fromLine(), To:recipient, Subject:subject, HtmlBody:html, TextBody:text, MessageStream:process.env.POSTMARK_MESSAGE_STREAM || "outbound" })
    });
  } else if (provider === "sendgrid") {
    response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method:"POST", signal:timeout,
      headers:{ Authorization:"Bearer " + apiKey, "Content-Type":"application/json" },
      body:JSON.stringify({
        personalizations:[{to:[{email:recipient}]}],
        from:sender(), subject,
        content:[{type:"text/plain",value:text},{type:"text/html",value:html}]
      })
    });
  } else if (provider === "mailgun") {
    const domain = required("MAILGUN_DOMAIN");
    const form = new URLSearchParams({
      from:fromLine(), to:recipient, subject, text, html
    });
    response = await fetch("https://api.mailgun.net/v3/" + encodeURIComponent(domain) + "/messages", {
      method:"POST", signal:timeout,
      headers:{
        Authorization:"Basic " + Buffer.from("api:" + apiKey).toString("base64"),
        "Content-Type":"application/x-www-form-urlencoded"
      },
      body:form
    });
  } else {
    throw new Error("Unsupported EMAIL_PROVIDER: " + provider);
  }

  const raw = await response.text();
  if (!response.ok) throw new Error(provider + " email API returned " + response.status + ": " + raw.slice(0, 500));
  return { provider, response:raw.slice(0, 500) };
}
