// POST /api/subscribe
// Writes a new subscriber to Supabase.

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  // CORS — allow requests from rumbo.wtf
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

  // Basic validation
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

  const validDays = ["M", "T", "W", "T", "F", "S", "S"];
  const cleanDays = Array.isArray(days)
    ? days.filter((d) => typeof d === "string" && d.length === 1)
    : [];

  if (cleanDays.length === 0) {
    return res.status(400).json({ error: "Select at least one day" });
  }

  const { error } = await supabase.from("subscribers").upsert(
    {
      email: email.toLowerCase().trim(),
      language: lang,
      regions: cleanRegions,
      days: cleanDays,
      active: true,
    },
    { onConflict: "email" }
  );

  if (error) {
    console.error("Supabase insert error:", error.message);
    return res.status(500).json({ error: "Failed to save subscription" });
  }

  return res.status(200).json({ ok: true });
}
