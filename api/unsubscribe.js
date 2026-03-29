// GET /api/unsubscribe?token=xxx
// Sets active=false for the matching subscriber. Returns an HTML confirmation page.

import { createClient } from "@supabase/supabase-js";

const page = (title, message) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title} · Rumbo</title>
  <link rel="icon" type="image/png" href="/favicon.png"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{background:#faf9f6;color:#1a1a18;font-family:Georgia,'Times New Roman',serif;line-height:1.65;display:flex;flex-direction:column;min-height:100vh;}
    nav{background:#1a1a18;padding:10px 32px;display:flex;justify-content:space-between;align-items:center;}
    .logo{font-family:Georgia,serif;font-size:22px;color:#f5f3ee;letter-spacing:-0.5px;}
    .logo em{font-style:normal;color:#c8a84a;}
    .content{max-width:640px;margin:0 auto;padding:72px 24px;flex:1;}
    .pre{font-family:'Courier New',monospace;font-size:10px;letter-spacing:2px;color:#888;margin-bottom:20px;}
    h1{font-size:28px;font-weight:400;color:#1a1a18;margin-bottom:16px;}
    p{font-size:16px;color:#555;line-height:1.7;margin-bottom:16px;}
    a{color:#7a5c0a;text-decoration:underline;text-underline-offset:3px;}
  </style>
</head>
<body>
<nav><div class="logo">Rumbo<em>.wtf</em></div></nav>
<div class="content">
  <div class="pre">Newsletter</div>
  <h1>${title}</h1>
  ${message}
</div>
</body>
</html>`;

export default async function handler(req, res) {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  const { token } = req.query;

  if (!token) {
    res.setHeader("Content-Type", "text/html");
    return res.status(400).send(
      page("Invalid link", "<p>No unsubscribe token found in this link. If you received this link in an email, try clicking it again.</p>")
    );
  }

  const { data, error } = await supabase
    .from("subscribers")
    .update({ active: false })
    .eq("unsubscribe_token", token)
    .select("email");

  if (error || !data || data.length === 0) {
    res.setHeader("Content-Type", "text/html");
    return res.status(404).send(
      page("Link not found", "<p>This unsubscribe link is not recognised. You may have already unsubscribed, or the link may be expired.</p><p><a href='/'>Back to Rumbo</a></p>")
    );
  }

  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(
    page("Unsubscribed", `<p>You have been removed from the Rumbo newsletter. No further emails will be sent.</p><p><a href='/'>Back to Rumbo</a></p>`)
  );
}
