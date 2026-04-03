// Rumbo.wtf — daily generation script
// Calls Claude API (global + regional), renders one HTML file per region/language combination
// Run: node generate.js

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Load translations ─────────────────────────────────────────────────────────
const TRANSLATIONS = JSON.parse(fs.readFileSync("translations.json", "utf8"));

// ─── English string defaults ──────────────────────────────────────────────────
// Single source of truth for all UI strings.
// Non-English locales override selectively via translations.json.
// Nav and footer links intentionally stay in English for all locales.
const EN_STRINGS = {
  NAV_LATEST: "Brief",
  NAV_ABOUT: "About",
  NAV_SIGNUP: "Newsletter",
  META_UPDATED_LABEL: "Edition:",
  ITEMS_SUFFIX: "signals",
  MEANWHILE_TITLE: "Meanwhile",
  LOCALE_LANGUAGE: "Language",
  LOCALE_LOCAL_CONTEXT: "Local news",
  FOOTER_LATEST: "Latest",
  FOOTER_ABOUT: "About",
  SOURCE_TIP: "Approximate number of independent source clusters found. More sources means wider reporting — not that the story is accurate.",
  SOURCE_PILL_LABEL: "sources",
  CATEGORIES: {
    culture: "Culture & sports",
    science_tech: "Science & tech",
    wellbeing: "Wellbeing",
    worldviews: "Worldviews",
  },
  CATEGORY_TOOLTIPS: {
    culture: "The lighter side of being human",
    science_tech: "What is becoming possible",
    wellbeing: "Health, medicine, and how people live",
    worldviews: "Belief systems and group thinking",
  },
};

// ─── Region config ────────────────────────────────────────────────────────────
// file:   English output filename
// esFile: Spanish output filename

const REGIONS = [
  { code: "es", name: "Spain",          file: "index-es.html",  esFile: "index-spain-es.html" },
  { code: "no", name: "Norway",         file: "index-no.html",  esFile: "index-norway-es.html" },
  { code: "uk", name: "United Kingdom", file: "index-uk.html",  esFile: "index-uk-es.html" },
  { code: "nl", name: "Netherlands",    file: "index-nl.html",  esFile: "index-nl-es.html" },
];

// Global Spanish file — generated separately from the REGIONS loop
const GLOBAL_ES_FILE = "index-global-es.html";

// ─── Prompts ──────────────────────────────────────────────────────────────────

// NOTE: Keep in sync with the prompt displayed in about.html
const GLOBAL_PROMPT = `You are the editorial engine for Rumbo.wtf, a world intelligence brief. Search the web for the most consequential global developments from the last 72 hours. Apply the following editorial rules:

SELECTION
- Select exactly 3-4 items. No more, no fewer.
- Select by second-order consequences, not by volume of coverage. A development that shifts how hundreds of millions of people live outranks one that dominates coverage but affects only one country's domestic politics. Actively discount story loudness as a selection criterion.
- Apply a genuine global lens. If more than two items share the same geopolitical frame, or if the selection reflects only the most-covered corners of the world, replace the weakest with the most consequential development from elsewhere.

FRESHNESS
- Only include items with new developments or reporting within the last 72 hours. If nothing concrete changed in that window — a vote, statement, ruling, event — skip it regardless of significance. Verify the publication date of your sources; if you cannot find a source dated within the last 72 hours, do not include the item.
- Never include a specific calendar date (day and month) in body text unless you have verified it is from within the last 72 hours and the current year. If uncertain, omit the date entirely.
- Do not include announcements of future events as news items. Something scheduled to happen is not a development — only report what has already occurred.
- If a story was covered in yesterday's edition, find what specifically developed in the last 24 hours and lead with that. If nothing new has developed, deprioritise it in favour of fresher stories.

WRITING
- Plain language any curious adult can understand without prior knowledge. No jargon, acronyms, or financial language — translate everything.
- No individual names in headlines unless the person's identity is the story, not their action or position. Avoid personality-driven headlines — lead with the institution, country, or dynamic instead.
- Avoid figures that are incidental or decorative — percentages, tallies, and market numbers that could be cut without losing the story. Keep figures that are the story: a price, duration, count, or threshold that is the actual fact being reported (e.g. "seven dollars monthly", "a two-month extension", "the first time in 50 years"). When a figure is not essential to understanding what happened or why it matters, describe direction and magnitude qualitatively instead: 'reserves are critically low', 'prices rose sharply', 'a large majority voted'. If in doubt, omit.
- Write numbers as numerals for 10 and above, and as words for single digits — "69 soldiers", "2008", "10%", "35-year-old", "3.3%", but "three countries", "two senators". This applies everywhere including headlines, compound adjectives, and percentages.
- Never include vague time references ("this week", "recently", "on Friday") unless you can cite the exact date from a source.
- Exactly two sentences per item. Each sentence 20 words or fewer. Sentence one: what happened. Sentence two: why it matters or what shifts as a result — not an additional fact, but a consequence, tension, or implication. If you cannot identify a genuine consequence, the story is not ready.
- Avoid passive voice that hides agency.
- Alien-observer neutrality: no home team, no ideology. Describe what actors do, not whether they are right.
- Every specific claim — context, causation, timeframes, institutional relationships — must be attributable to a source you found in your search. Do not infer, estimate, or complete a sentence with plausible-sounding context. If a piece of information is not in your search results, omit it entirely rather than filling the gap.

STRUCTURE
- Geo tag each item: Global / Europe / Asia / Africa / Americas / Oceania
- Count genuinely independent source clusters per item (organisations that did their own reporting, not syndication). Include as a "sources" integer.

MEANWHILE
- Exactly 4 Meanwhile items, one per category in this exact order: culture, science_tech, wellbeing, worldviews. All four required every time.
- Meanwhile = things worth knowing that sit outside the daily news cycle. Each item must have been reported or newly relevant within the last 30 days — not breaking news, but not recycled history either. Surprising, interesting, worth a search. Each item maximum 15 words, no analysis.
- Must not repeat, reference, or summarise any story, person, event, or entity already in the main feed — even from a different angle.
- Each Meanwhile item must include a "search" field with a good DuckDuckGo search query.
- Culture: something that happened or was discovered — a performance, a record broken, a work released, an unexpected cultural moment. HARD EXCLUSIONS: festival lineups, award nominations, competition schedules, event announcements, anything that describes what is coming rather than what occurred. If the item could appear in an "upcoming events" section, reject it.
- Science_tech: something that changes what is physically or technically possible — a genuine capability shift, unexpected finding, or newly published result. Not recurring security incidents, hacking reports, or policy announcements. Not "X company releases Y product." The test: does this change what humans or machines can do, or does it just describe what someone did?
- Wellbeing: health, medicine, longevity — how people are living.
- Worldviews: a shift in how a group of people think, believe, or define themselves — ideology, religion, identity, or political culture changing at a population level. HARD EXCLUSIONS: news events, disasters, policy outcomes, economic responses, competition results, entertainment announcements, anything that could appear in the main news feed. The test: does this describe a change in what people believe or how they identify — not what they did or what happened to them?

CRITICAL: Your response must be ONLY the raw JSON object. No thinking, no explanation, no markdown, no preamble. Start your response with { and end with }. Any text outside the JSON will break the parser.
{
  "generated_at": "ISO timestamp",
  "sources": ["outlet1", "outlet2"],
  "items": [
    {
      "headline": "string",
      "body": "string — two sentences",
      "geo": "string",
      "sources": 4
    }
  ],
  "meanwhile": [
    {
      "category": "culture|science_tech|wellbeing|worldviews",
      "text": "string — one line",
      "search": "duckduckgo search query string"
    }
  ]
}`;

const REGIONAL_PROMPT = (regionName, globalJson) =>
  `You are the regional editor for Rumbo.wtf covering ${regionName}.

The global edition for today has already been generated. Here it is for context:
${globalJson}

Search the web for the single most consequential development in ${regionName} from the last 72 hours that is NOT already covered in the global edition above. Only include a second item if it is clearly distinct, equally fresh, and genuinely significant — do not pad. Zero items is better than a weak or stale story.

Consequential means: the story shifts something beyond its immediate domain — a policy change that affects daily life, an economic move with cross-sector effects, a social development with structural implications. A loud domestic controversy with no second-order consequences does not qualify, regardless of how much local coverage it receives.

Rules:
- Only include items genuinely specific to ${regionName} and not already represented in the global feed
- Same format as global items: plain language, two sentences, no individual names in headlines
- Exactly two sentences per item. Each sentence must be 20 words or fewer. Sentence one: what happened. Sentence two: why it matters or what shifts as a result — not an additional fact, but a consequence, tension, or implication.
- Avoid incidental figures — drop percentages, tallies, and market numbers that aren't central to the story. Keep figures that are genuinely the fact being reported (e.g. a key price, a specific duration, a count that defines the outcome). If uncertain, describe qualitatively instead.
- Write numbers as numerals for 10 and above, and as words for single digits — "69 soldiers", "2008", "10%", but "three countries", "two senators".
- Only include items that have new developments or reporting within the last 72 hours. If a story's most recent coverage is older than 72 hours, skip it regardless of significance.
- Before including any item, verify the publication date of your sources. If you cannot find a source dated within the last 72 hours, do not include that item.
- For each item, the newness must be concrete: a vote that happened, a statement made, a figure released, an event that occurred — all within the last 72 hours. Do not include ongoing situations unless something specific changed in that window.
- If you cannot find 1-2 genuinely fresh items for this region, return only one item — the most recent thing you can verify — rather than padding with older stories.
- Never include time references like "this week", "on Friday", "recently", or "announced today" in headlines or body text unless you can verify the exact date from a source. Use the factual content only — the freshness is implied by the 72-hour rule.
- Never include a specific calendar date (day and month) in body text unless you have verified it is from within the last 72 hours. If uncertain of the year, omit the date entirely.
- When citing a specific date from a source, verify it is from the current year. A real date from a previous year is worse than no date — it presents old news as current fact.
- Do not include announcements of future events as news items. Something scheduled to happen is not a development — only report what has already occurred.
- You must be able to cite a specific headline, outlet, and publication date for each item. If you cannot name all three from your search results, do not include the item.
- Every specific claim — context, causation, timeframes, relationships — must come from your search results. Do not infer or complete sentences with plausible-sounding context. If information is not in your results, omit it.
- If the most recent independent source you can find for a story is more than 30 days old, it is not eligible regardless of how the headline is phrased.
- Count independent source clusters per item
- If you cannot find any genuinely fresh items for this region, return an empty items array rather than padding with stale stories.

CRITICAL: Your response must be ONLY the raw JSON object. Start with { and end with }. No other text.
{
  "items": [
    {
      "headline": "string",
      "body": "string — two sentences",
      "geo": "${regionName}",
      "sources": 2
    }
  ]
}`;

// Style anchors per language — multiple outlets to avoid ideological lean
const STYLE_ANCHORS = {
  Spanish: "El País, El Mundo, and RTVE",
};

const TRANSLATE_PROMPT = (langName, contentJson) => {
  const anchor = STYLE_ANCHORS[langName];
  const styleInstruction = anchor
    ? `- Write as a journalist would for outlets like ${anchor} — use the vocabulary, sentence rhythm, and editorial voice of quality ${langName} journalism, not translated English phrasing.`
    : `- Write as if originally authored in ${langName} — natural phrasing, not word-for-word translation.`;
  return `Translate the following Rumbo.wtf JSON content into ${langName}.

Rules:
- Translate ONLY the string values of: "headline" and "body" in items; "text" in meanwhile items
- Do NOT translate: JSON keys, "geo" values, "category" values, "search" field values, integers
${styleInstruction}
- Keep headlines punchy and direct
- Do not use any markdown formatting (no asterisks, underscores, or other markup) in translated text

CRITICAL: Return ONLY the raw JSON object with the exact same structure as the input. Start with { and end with }. No other text.

${contentJson}`;
};

// ─── API calls ────────────────────────────────────────────────────────────────

// Two-step call: search pass then format pass. Used for global and regional editions.
async function callClaude(prompt) {
  const timeout = 600000; // 10 minutes

  const searchResponse = await Promise.race([
    client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 3000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Claude API timeout (search)")), timeout)
    ),
  ]);

  const searchText = searchResponse.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const formatResponse = await Promise.race([
    client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      system: "You are a JSON formatter. Output only raw valid JSON. Start with { and end with }. No other text.",
      messages: [
        {
          role: "user",
          content: `Format this content as the required JSON structure:\n\n${searchText}\n\n${prompt}`,
        },
      ],
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Claude API timeout (format)")), timeout)
    ),
  ]);

  const textBlock = formatResponse.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No text in Claude response");
  return textBlock.text.trim();
}

// Single call, no search. Used for translation passes.
async function callClaudeSimple(prompt) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 3000,
    system: "You are a JSON translator. Output only raw valid JSON. Start with { and end with }. No other text.",
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No text in Claude response");
  return textBlock.text.trim();
}

// ─── JSON parse ───────────────────────────────────────────────────────────────

function parseJson(raw) {
  const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  if (clean.startsWith("{")) return JSON.parse(clean);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1) return JSON.parse(raw.slice(start, end + 1));
  throw new Error("No JSON object found in response");
}

// ─── Translations ─────────────────────────────────────────────────────────────

function getTranslations(locale) {
  if (locale === "en" || !TRANSLATIONS[locale]) return EN_STRINGS;
  const loc = TRANSLATIONS[locale];
  return {
    ...EN_STRINGS,
    ...loc,
    CATEGORIES: { ...EN_STRINGS.CATEGORIES, ...(loc.CATEGORIES || {}) },
    CATEGORY_TOOLTIPS: { ...EN_STRINGS.CATEGORY_TOOLTIPS, ...(loc.CATEGORY_TOOLTIPS || {}) },
  };
}

// ─── Translation helper ────────────────────────────────────────────────────────

async function translateData(data, langName) {
  const toTranslate = { items: data.items, meanwhile: data.meanwhile };
  const translatedRaw = await callClaudeSimple(
    TRANSLATE_PROMPT(langName, JSON.stringify(toTranslate, null, 2))
  );
  const translated = parseJson(translatedRaw);
  return { ...data, ...translated };
}

// ─── HTML rendering ───────────────────────────────────────────────────────────

function ddgUrl(query) {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}

function renderItem(item, t) {
  const regionalGeos = ["Spain", "Norway", "UK", "United Kingdom", "Netherlands"];
  const isRegional = regionalGeos.includes(item.geo);
  const pillClass = isRegional ? "geo-pill regional" : "geo-pill";
  const dotClass = isRegional ? "dot dot-regional" : "dot dot-global";
  const searchQuery = isRegional
    ? encodeURIComponent(item.headline + " " + item.geo)
    : encodeURIComponent(item.headline);

  return `  <div class="item">
    <div class="${dotClass}"></div>
    <div class="item-body">
      <div class="item-head">${item.headline}</div>
      <div class="item-text">${item.body}</div>
      <div class="item-foot">
        <span class="${pillClass}">${item.geo}</span>
        <a class="search-link" href="https://duckduckgo.com/?q=${searchQuery}" target="_blank">↗</a>
        <span class="source-pill">~${item.sources} ${t.SOURCE_PILL_LABEL}<span class="src-tip">${t.SOURCE_TIP}</span></span>
      </div>
    </div>
  </div>`;
}

function renderMeanwhile(items, t) {
  return items
    .map((item) => {
      const label = t.CATEGORIES[item.category] || item.category;
      const tooltip = t.CATEGORY_TOOLTIPS[item.category] || "";
      return `    <div class="nw-item">
      <div class="nw-top">
        <div class="nw-cat-wrap"><span class="nw-cat">${label}</span><div class="nw-tooltip">${tooltip}</div></div>
        <a class="nw-search" href="${ddgUrl(item.search)}" target="_blank">↗</a>
      </div>
      <span class="nw-txt">${item.text}</span>
    </div>`;
    })
    .join("\n");
}

function renderHtml(data, date, locale = "en") {
  const t = getTranslations(locale);
  const allItems = data.items;
  const itemCount = allItems.length;
  const utcTime = new Date();
  const isoString = utcTime.toISOString();

  let html = fs.readFileSync("template.html", "utf8");

  // Inject feed
  const feedStart = html.indexOf("<!-- FEED:START -->");
  const feedEnd = html.indexOf("<!-- FEED:END -->") + "<!-- FEED:END -->".length;
  html =
    html.slice(0, feedStart) +
    `<!-- FEED:START -->\n<div class="feed">\n${allItems.map((item) => renderItem(item, t)).join("\n")}\n</div>\n` +
    "<!-- FEED:END -->" +
    html.slice(feedEnd);

  // Inject meanwhile
  const mwStart = html.indexOf("<!-- MEANWHILE:START -->");
  const mwEnd = html.indexOf("<!-- MEANWHILE:END -->") + "<!-- MEANWHILE:END -->".length;
  html =
    html.slice(0, mwStart) +
    `<!-- MEANWHILE:START -->\n<div class="nw-grid">\n${renderMeanwhile(data.meanwhile, t)}\n  </div>\n` +
    "<!-- MEANWHILE:END -->" +
    html.slice(mwEnd);

  // Update date — keep token in place so replaceAll picks it up at the end
  html = html.replace(/\{\{META_UPDATED_LABEL\}\} [^<&]+/, `{{META_UPDATED_LABEL}} ${date}`);

  // Update item count — keep token in place
  html = html.replace(/>\d+\s+\{\{ITEMS_SUFFIX\}\}</, `>${itemCount} {{ITEMS_SUFFIX}}<`);

  // Update UTC timestamp for client-side timezone localisation
  html = html.replace(
    /var utc = new Date\('[^']+'\)/,
    `var utc = new Date('${isoString}')`
  );

  // Hardcode timestamp locale per file — not dependent on localStorage lang
  const jsLocaleMap = { en: "en-GB", es: "es-ES" };
  html = html.replace("{{JS_LOCALE}}", jsLocaleMap[locale] || "en-GB");

  // Set correct active language pill based on render locale (baked in, no JS dependency)
  if (locale !== "en") {
    html = html.replace(
      `<div class="lpill active" onclick="setLang(event,'EN')">`,
      `<div class="lpill" onclick="setLang(event,'EN')">`
    );
    html = html.replace(
      `<div class="lpill" onclick="setLang(event,'${locale.toUpperCase()}')">`,
      `<div class="lpill active" onclick="setLang(event,'${locale.toUpperCase()}')">`
    );
  }

  // Apply all flat string tokens from translations
  for (const [key, val] of Object.entries(t)) {
    if (typeof val === "string") {
      html = html.replaceAll(`{{${key}}}`, val);
    }
  }

  return html;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// ─── Email rendering ──────────────────────────────────────────────────────────

function renderEmail(data, date, locale, unsubscribeUrl) {
  const t = getTranslations(locale);
  const items = data.items;
  const meanwhile = data.meanwhile;

  const geoStyle = (geo) => {
    const regional = ["Spain", "Norway", "UK", "United Kingdom", "Netherlands"];
    return regional.includes(geo)
      ? "display:inline-block;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1px;color:#555;background:#f0ede6;border:1px solid #d0ccc4;padding:2px 8px;border-radius:3px;margin-right:6px;"
      : "display:inline-block;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1px;color:#7a5c0a;background:#f5ead0;border:1px solid #e0c87a;padding:2px 8px;border-radius:3px;margin-right:6px;";
  };

  const itemsHtml = items.map((item) => `
    <tr><td class="rp" style="padding:20px 28px 0;">
      <div style="font-family:Georgia,serif;font-size:17px;color:#1a1a18;line-height:1.35;margin-bottom:8px;">${item.headline}</div>
      <div style="font-family:Georgia,serif;font-size:14px;color:#444;line-height:1.65;margin-bottom:10px;">${item.body}</div>
      <div>
        <span style="${geoStyle(item.geo)}">${item.geo}</span>
        <span style="font-family:'Courier New',monospace;font-size:10px;color:#aaa;">~${item.sources} ${t.SOURCE_PILL_LABEL}</span>
        <a href="https://duckduckgo.com/?q=${encodeURIComponent(item.headline + (item.geo !== 'Global' ? ' ' + item.geo : ''))}" style="font-family:'Courier New',monospace;font-size:11px;color:#c8a84a;text-decoration:none;margin-left:8px;" target="_blank">&#x2197;</a>
      </div>
    </td></tr>
    <tr><td class="rp" style="padding:12px 28px 0;"><hr style="border:none;border-top:1px solid #e8e4de;margin:0;"></td></tr>`
  ).join("\n");

  const meanwhileHtml = meanwhile.map((item) => {
    const label = t.CATEGORIES[item.category] || item.category;
    return `
    <tr><td class="rp" style="padding:10px 28px 0;">
      <div style="font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.5px;color:#c8a84a;text-transform:uppercase;margin-bottom:4px;">${label}</div>
      <div style="font-family:Georgia,serif;font-size:14px;color:#333;line-height:1.55;">${item.text}${item.search ? ` <a href="https://duckduckgo.com/?q=${encodeURIComponent(item.search)}" style="font-family:'Courier New',monospace;font-size:11px;color:#c8a84a;text-decoration:none;" target="_blank">&#x2197;</a>` : ''}</div>
    </td></tr>`;
  }).join("\n");

  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Rumbo · ${date}</title>
  <style>
    @media only screen and (max-width:600px) {
      .rp { padding-left:16px !important; padding-right:16px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f5f3ee;font-family:Georgia,'Times New Roman',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ee;">
<tr><td align="center" style="padding:24px 16px;">
<table cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#faf9f6;border-radius:4px;border:1px solid #e0dcd4;">

  <!-- Header -->
  <tr><td class="rp" style="background:#1a1a18;padding:16px 28px;border-radius:4px 4px 0 0;">
    <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td><span style="font-family:Georgia,serif;font-size:20px;color:#f5f3ee;letter-spacing:-0.5px;">Rumbo<span style="color:#c8a84a;">.wtf</span></span></td>
      <td align="right"><span style="font-family:'Courier New',monospace;font-size:10px;color:#888;letter-spacing:1px;">${date}</span></td>
    </tr>
    </table>
  </td></tr>

  <!-- Spacer -->
  <tr><td style="padding:8px 0 0;"></td></tr>

  <!-- Items -->
  ${itemsHtml}

  <!-- Meanwhile header -->
  <tr><td class="rp" style="padding:28px 28px 0;">
    <div style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:2px;color:#1a1a18;text-transform:uppercase;border-bottom:2px solid #1a1a18;padding-bottom:6px;">${t.MEANWHILE_TITLE}</div>
  </td></tr>

  <!-- Meanwhile items -->
  ${meanwhileHtml}

  <!-- Footer -->
  <tr><td class="rp" style="padding:28px 28px 20px;text-align:center;">
    <p style="font-family:'Courier New',monospace;font-size:10px;color:#aaa;line-height:1.8;margin:0;">
      <a href="https://rumbo.wtf" style="color:#c8a84a;text-decoration:none;">rumbo.wtf</a>
      &nbsp;·&nbsp;
      <a href="${unsubscribeUrl}" style="color:#aaa;text-decoration:underline;">Unsubscribe</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Rumbo generator starting...");

  // Step 1: load previous run context to avoid repetition
  let previousContext = "";
  let previousMeanwhileContext = "";
  try {
    const lastOutput = JSON.parse(fs.readFileSync("last_output.json", "utf8"));
    const headlines = lastOutput.items.map(i => `- ${i.headline}`).join("\n");
    const meanwhiles = lastOutput.meanwhile.map(i => `- ${i.text}`).join("\n");
    previousContext = `\nThe previous edition covered these stories. Do not repeat the same topics, angles, or entities — find what is genuinely new:\n${headlines}\n`;
    previousMeanwhileContext = `\nThe previous edition's Meanwhile section covered:\n${meanwhiles}\nDo not repeat these topics or closely related ones.\n`;
    console.log("Loaded previous run context for deduplication.");
  } catch (e) {
    console.log("No previous run context found — first run.");
  }

  // Step 2: global call — runs once, shared across all editions
  console.log("Calling Claude for global edition...");
  let globalData;
  try {
    const globalRaw = await callClaude(GLOBAL_PROMPT + previousContext + previousMeanwhileContext);
    globalData = parseJson(globalRaw);
    console.log(`Global: ${globalData.items.length} items, ${globalData.meanwhile.length} meanwhile`);
  } catch (e) {
    console.error("Global call failed:", e.message);
    process.exit(1);
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Step 3: render global EN edition
  console.log("Rendering index.html (global, EN)...");
  const globalHtml = renderHtml({ ...globalData }, dateStr, "en");
  fs.writeFileSync("index.html", globalHtml, "utf8");
  console.log("index.html written.");

  // Step 4: render global ES edition
  console.log("Translating global edition to Spanish...");
  try {
    const globalDataEs = await translateData(globalData, "Spanish");
    const globalEsHtml = renderHtml(globalDataEs, dateStr, "es");
    fs.writeFileSync(GLOBAL_ES_FILE, globalEsHtml, "utf8");
    console.log(`${GLOBAL_ES_FILE} written.`);
  } catch (e) {
    console.error(`Global ES translation failed: ${e.message}`);
    console.log(`Writing EN fallback for ${GLOBAL_ES_FILE}.`);
    fs.writeFileSync(GLOBAL_ES_FILE, globalHtml, "utf8");
  }

  // Step 5: regional editions
  const allRegionalItems = {}; // { regionCode: [items] } — used by Step 7

  for (const region of REGIONS) {
    console.log(`Calling Claude for ${region.name} regional top-up...`);
    try {
      const regionalRaw = await callClaude(
        REGIONAL_PROMPT(region.name, JSON.stringify(globalData, null, 2)) + previousContext
      );
      const regionalData = parseJson(regionalRaw);

      // Merge: global items + regional items
      const mergedData =
        regionalData.items && regionalData.items.length > 0
          ? { ...globalData, items: [...globalData.items, ...regionalData.items] }
          : { ...globalData };

      if (regionalData.items && regionalData.items.length > 0) {
        console.log(`Added ${regionalData.items.length} regional items for ${region.name}`);
        allRegionalItems[region.code] = regionalData.items;
      } else {
        console.log(`No regional items for ${region.name}, using global-only content.`);
      }

      // Render EN version
      const regionalHtml = renderHtml(mergedData, dateStr, "en");
      fs.writeFileSync(region.file, regionalHtml, "utf8");
      console.log(`${region.file} written.`);

      // Render ES version if configured
      if (region.esFile) {
        console.log(`Translating ${region.name} edition to Spanish...`);
        try {
          const mergedDataEs = await translateData(mergedData, "Spanish");
          const regionalEsHtml = renderHtml(mergedDataEs, dateStr, "es");
          fs.writeFileSync(region.esFile, regionalEsHtml, "utf8");
          console.log(`${region.esFile} written.`);
        } catch (e) {
          console.error(`ES translation failed for ${region.name}: ${e.message}`);
          console.log(`Writing EN fallback for ${region.esFile}.`);
          fs.writeFileSync(region.esFile, regionalHtml, "utf8");
        }
      }

    } catch (e) {
      console.error(`Regional call failed for ${region.name}:`, e.message);
      console.log(`Writing global-only EN fallback for ${region.name}.`);
      fs.writeFileSync(region.file, globalHtml, "utf8");
      if (region.esFile) {
        fs.writeFileSync(region.esFile, globalHtml, "utf8");
      }
    }
  }

  // Step 6: save JSON outputs
  fs.writeFileSync("last_output.json", JSON.stringify(globalData, null, 2), "utf8");
  console.log("Raw JSON saved to last_output.json");

  const allOutput = { date: dateStr, global: globalData, regional_items: allRegionalItems };
  fs.writeFileSync("all_output.json", JSON.stringify(allOutput, null, 2), "utf8");
  console.log("all_output.json saved.");

  // Step 7: send newsletter
  if (process.env.SEND_NEWSLETTER === "false") {
    console.log("Newsletter send skipped (SEND_NEWSLETTER=false).");
  } else {
  console.log("Starting newsletter send...");
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const dayCodes = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    const todayCode = dayCodes[new Date().getDay()];
    console.log(`Today is: ${todayCode}`);

    const { data: subscribers, error: subError } = await supabase
      .from("subscribers")
      .select("*")
      .eq("active", true)
      .eq("confirmed", true);

    if (subError) throw new Error(`Supabase query failed: ${subError.message}`);
    console.log(`${subscribers.length} confirmed active subscribers found.`);

    let sent = 0;
    let skipped = 0;

    for (const sub of subscribers) {
      if (!sub.days || !sub.days.includes(todayCode)) {
        skipped++;
        continue;
      }

      // Build merged item list for this subscriber
      const regionalItems = [];
      for (const regionCode of (sub.regions || [])) {
        if (allRegionalItems[regionCode]) {
          regionalItems.push(...allRegionalItems[regionCode]);
        }
      }
      const mergedData = { ...globalData, items: [...globalData.items, ...regionalItems] };

      // Translate if ES subscriber
      let emailData = mergedData;
      if (sub.language === "ES") {
        try {
          emailData = await translateData(mergedData, "Spanish");
        } catch (e) {
          console.error(`Translation failed for ${sub.email}, sending EN: ${e.message}`);
        }
      }

      const locale = sub.language === "ES" ? "es" : "en";
      const unsubUrl = `https://rumbo.wtf/api/unsubscribe?token=${sub.unsubscribe_token}`;
      const emailHtml = renderEmail(emailData, dateStr, locale, unsubUrl);

      const sendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Rumbo <brief@rumbo.wtf>",
          to: sub.email,
          subject: `Rumbo · ${dateStr}`,
          html: emailHtml,
        }),
      });

      if (!sendRes.ok) {
        const errBody = await sendRes.text();
        console.error(`Resend failed for ${sub.email}: ${errBody}`);
      } else {
        sent++;
        console.log(`Sent to ${sub.email}`);
      }
    }

    console.log(`Newsletter done. Sent: ${sent}, skipped (wrong day): ${skipped}.`);
  } catch (e) {
    console.error("Newsletter send failed:", e.message);
  }
  } // end SEND_NEWSLETTER check

  console.log("Done.");
}

main();
