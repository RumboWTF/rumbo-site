// POST /api/subscribe
// Writes a new subscriber to Supabase, sends confirmation email via Resend.

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  res.setHeader("Access-Control-Allow-Origin", "https://rumbo.wtf");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email, language, regions, days } = req.body;

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Invalid email" });
  }

  const lang = (language || "EN").toUpperCase();
  if (!["EN", "ES"].includes(lang)) {
    return res.status(400).json({ error: "Invalid language" });
  }

  const validRegions = ["es", "no", "uk", "nl"];
  const cleanRegions = Array.isArray(regions)
    ? regions.filter((r) => validRegions.includes(r))
    : [];

  const cleanDays = Array.isArray(days)
    ? days.filter((d) => ["Mo","Tu","We","Th","Fr","Sa","Su"].includes(d))
    : [];

  if (cleanDays.length === 0) {
    return res.status(400).json({ error: "Select at least one day" });
  }

  // Upsert subscriber — confirmed defaults to false in schema
  const { data, error } = await supabase.from("subscribers").upsert(
    {
      email: email.toLowerCase().trim(),
      language: lang,
      regions: cleanRegions,
      days: cleanDays,
      active: true,
    },
    { onConflict: "email" }
  ).select("confirm_token").single();

  if (error) {
    console.error("Supabase insert error:", error.message);
    return res.status(500).json({ error: "Failed to save subscription" });
  }

  // Send confirmation email
  const confirmUrl = `https://rumbo.wtf/api/confirm?token=${data.confirm_token}`;
  const confirmHtml = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Confirm your Rumbo subscription</title></head>
<body style="margin:0;padding:0;background:#f5f3ee;font-family:Georgia,'Times New Roman',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ee;">
<tr><td align="center" style="padding:40px 16px;">
<table cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#faf9f6;border-radius:4px;border:1px solid #e0dcd4;">
  <tr><td style="background:#1a1a18;padding:16px 28px;border-radius:4px 4px 0 0;">
    <span style="font-family:Georgia,serif;font-size:20px;color:#f5f3ee;letter-spacing:-0.5px;">Rumbo<span style="color:#c8a84a;">.wtf</span></span>
  </td></tr>
  <tr><td style="padding:32px 28px 12px;">
    <div style="font-family:Georgia,serif;font-size:18px;color:#1a1a18;margin-bottom:16px;">Confirm your subscription</div>
    <p style="font-family:Georgia,serif;font-size:14px;color:#555;line-height:1.7;margin:0 0 24px;">Click the button below to confirm your Rumbo newsletter subscription. If you did not sign up, ignore this email.</p>
    <a href="${confirmUrl}" style="display:inline-block;background:#1a1a18;color:#f5f3ee;font-family:'Courier New',monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:12px 24px;border-radius:3px;text-decoration:none;">Confirm subscription →</a>
  </td></tr>
  <tr><td style="padding:24px 28px;text-align:center;">
    <p style="font-family:'Courier New',monospace;font-size:10px;color:#aaa;line-height:1.8;margin:0;">
      <a href="https://rumbo.wtf" style="color:#c8a84a;text-decoration:none;">rumbo.wtf</a>
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const sendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Rumbo <brief@rumbo.wtf>",
      to: email.toLowerCase().trim(),
      subject: "Confirm your Rumbo subscription",
      html: confirmHtml,
    }),
  });

  if (!sendRes.ok) {
    const errBody = await sendRes.text();
    console.error("Resend confirmation email failed:", errBody);
    // Don't fail the request — subscriber is saved, confirmation can be resent later
  }

  return res.status(200).json({ ok: true });
}
