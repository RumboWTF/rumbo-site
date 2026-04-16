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
  LOCALE_LOCAL_CONTEXT: "Local news",
  FOOTER_LATEST: "Latest",
  FOOTER_ABOUT: "About",
  SOURCE_TIP: "Approximate number of independent source clusters found. More sources means wider reporting — not that the story is accurate.",
  SOURCE_PILL_LABEL: "sources",

};

// ─── Region config ────────────────────────────────────────────────────────────
const REGIONS = [
  { code: "es", name: "Spain",          file: "index-es.html"  },
  { code: "no", name: "Norway",         file: "index-no.html"  },
  { code: "uk", name: "United Kingdom", file: "index-uk.html"  },
  { code: "nl", name: "Netherlands",    file: "index-nl.html"  },
];

// ─── Prompts ──────────────────────────────────────────────────────────────────

// NOTE: Keep in sync with the prompt displayed in about.html
const GLOBAL_PROMPT = `You are the editorial engine for Rumbo.wtf, a world intelligence brief. Search the web for the most consequential global developments from the last 72 hours. Search broadly — English-language sources overrepresent certain regions. Actively seek out consequential developments that may not surface first in default search results. Apply the following editorial rules:

SELECTION
- Select exactly 3-4 items. No more, no fewer.
- Select purely by consequence. A development that shifts how hundreds of millions of people live outranks one that dominates coverage but affects only one country's domestic politics. Actively discount story loudness as a selection criterion.
- If two or more items share the same continent, verify each independently earns its place — don't let regional noise volume substitute for genuine global significance.

FRESHNESS
- Only include items with new developments or reporting within the last 72 hours. If nothing concrete changed, skip it regardless of significance.
- For every item, you must cite a specific headline, outlet, and publication date from your search results. The publication date must be within the last 72 hours. If you cannot name all three, do not include the item.
- Never include a specific calendar date (day and month) in body text unless you have verified it is from within the last 72 hours and the current year. If uncertain, omit the date entirely.
- Do not include any item whose news hook is an upcoming event — an election scheduled for Sunday, talks beginning tomorrow, a vote later this week. Only report what has already happened. If the only fresh angle is anticipation of a future event, skip the item.
- If a story was covered in yesterday's edition, find what specifically developed in the last 24 hours and lead with that. If nothing new has developed, deprioritise it in favour of fresher stories.

WRITING
- Plain language any curious adult can understand without prior knowledge. No jargon, acronyms, or financial language — translate everything.
- Avoid personality-driven headlines. Lead with the institution, country, or dynamic rather than a person's name — unless the person's identity or role is genuinely central to understanding the story (e.g. a corruption trial, a leadership appointment, a defection).
- Avoid figures that are incidental or decorative — percentages, tallies, and market numbers that could be cut without losing the story. Keep figures that are the story: a price, duration, count, or threshold that is the actual fact being reported (e.g. "seven dollars monthly", "a two-month extension", "the first time in 50 years"). When a figure is not essential to understanding what happened or why it matters, describe direction and magnitude qualitatively instead: 'reserves are critically low', 'prices rose sharply', 'a large majority voted'. If in doubt, omit.
- Write numbers as numerals for 10 and above, and as words for single digits — "69 soldiers", "2008", "10%", "35-year-old", "3.3%", but "three countries", "two senators". This applies everywhere including headlines, compound adjectives, and percentages.
- Never include vague time references ("this week", "recently", "on Friday") unless you can cite the exact date from a source.
- Exactly two sentences per item. Each sentence 20 words or fewer. Sentence one: what happened. Sentence two: why it matters or what shifts as a result — not an additional fact, but a consequence, tension, or implication. If you cannot identify a genuine consequence, the story is not ready. Count the words in each sentence before outputting. If either exceeds 20 words, rewrite it. No exceptions.
- Avoid passive voice that hides agency.
- Alien-observer neutrality: no home team, no ideology. Describe what actors do, not whether they are right.
- Every specific claim — context, causation, timeframes, institutional relationships — must be attributable to a source you found in your search. Do not infer, estimate, or complete a sentence with plausible-sounding context. If a piece of information is not in your search results, omit it entirely rather than filling the gap.
- High hallucination risk: central bank decisions, election results, court rulings, and legislative votes are the categories where plausible-sounding fabrications are most likely. For any such item, you must cite a specific headline, outlet, and publication date from your search. If you cannot, do not include it.

STRUCTURE
- Geo tag each item: Global / Europe / Asia / Africa / Americas / Oceania
- Count genuinely independent source clusters per item (organisations that did their own reporting, not syndication). Include as a "sources" integer.

CRITICAL: Your response must be ONLY the raw JSON object. No thinking, no explanation, no markdown, no preamble. Start your response with { and end with }. Do not use markdown formatting (no asterisks, underscores, or other markup) in any string values. Any text outside the JSON will break the parser.
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
- Same format as global items: plain language, two sentences. Avoid personality-driven headlines unless the person's identity or role is central to the story.
- Exactly two sentences per item. Each sentence must be 20 words or fewer. Sentence one: what happened. Sentence two: why it matters or what shifts as a result — not an additional fact, but a consequence, tension, or implication. Count the words in each sentence before outputting. If either exceeds 20 words, rewrite it. No exceptions.
- Avoid incidental figures — drop percentages, tallies, and market numbers that aren't central to the story. Keep figures that are genuinely the fact being reported (e.g. a key price, a specific duration, a count that defines the outcome). If uncertain, describe qualitatively instead.
- Write numbers as numerals for 10 and above, and as words for single digits — "69 soldiers", "2008", "10%", but "three countries", "two senators".
- Only include items that have new developments or reporting within the last 72 hours. If a story's most recent coverage is older than 72 hours, skip it regardless of significance.
- For every item, you must cite a specific headline, outlet, and publication date from your search results. The publication date must be within the last 72 hours. If you cannot name all three, do not include the item.
- If you cannot find 1-2 genuinely fresh items for this region, return only one item — the most recent thing you can verify — rather than padding with older stories.
- Never include time references like "this week", "on Friday", "recently", or "announced today" in headlines or body text unless you can verify the exact date from a source. Use the factual content only — the freshness is implied by the 72-hour rule.
- Never include a specific calendar date (day and month) in body text unless you have verified it is from within the last 72 hours. If uncertain of the year, omit the date entirely.
- When citing a specific date from a source, verify it is from the current year. A real date from a previous year is worse than no date — it presents old news as current fact.
- Do not include any item whose news hook is an upcoming event — an election scheduled for Sunday, talks beginning tomorrow, a vote later this week. Only report what has already happened. If the only fresh angle is anticipation of a future event, skip the item.
- You must be able to cite a specific headline, outlet, and publication date for each item. If you cannot name all three from your search results, do not include the item.
- Every specific claim — context, causation, timeframes, relationships — must come from your search results. Do not infer or complete sentences with plausible-sounding context. If information is not in your results, omit it.
- If the most recent independent source you can find for a story is more than 30 days old, it is not eligible regardless of how the headline is phrased.
- Count independent source clusters per item
- If you cannot find any genuinely fresh items for this region, return an empty items array rather than padding with stale stories.

CRITICAL: Your response must be ONLY the raw JSON object. Start with { and end with }. No other text. Do not use markdown formatting (no asterisks, underscores, or other markup) in any string values.
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

// ─── API calls ────────────────────────────────────────────────────────────────

// Two-step call: search pass then format pass. Used for global edition.
// Pass 1 uses a short search-only prompt to avoid exceeding the 200k token limit.
// Pass 2 receives the full editorial prompt + capped search results for formatting.
async function callClaude(prompt, deduplicationHint = "") {
  const timeout = 600000; // 10 minutes

  const searchPrompt = `Search the web broadly for the most consequential global developments from the last 72 hours. English-language sources overrepresent certain regions — actively seek out developments that may not surface first in default results. Return a detailed summary of what you find.${deduplicationHint}`;

  const searchResponse = await Promise.race([
    client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 3000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: searchPrompt }],
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Claude API timeout (search)")), timeout)
    ),
  ]);

  const searchText = searchResponse.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .slice(0, 30000); // cap at 30k chars (~7-8k tokens)

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
  const su = searchResponse.usage || {};
  const fu = formatResponse.usage || {};
  console.log(`[tokens] global search — in:${su.input_tokens ?? '?'} out:${su.output_tokens ?? '?'}`);
  console.log(`[tokens] global format — in:${fu.input_tokens ?? '?'} out:${fu.output_tokens ?? '?'}`);
  return textBlock.text.trim();
}

// Two-pass call for regional editions — mirrors global approach to cap token usage.
// Pass 1: short search prompt with web tool, capped at 30k chars.
// Pass 2: format pass with capped results + full editorial prompt, no web tool.
async function callClaudeSinglePass(prompt, regionName = "regional") {
  const timeout = 600000;

  const searchPrompt = `Search the web for the single most consequential news development in ${regionName} from the last 72 hours. Return a detailed summary of what you find.`;

  const searchResponse = await Promise.race([
    client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: searchPrompt }],
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Claude API timeout (search)")), timeout)
    ),
  ]);

  const searchText = searchResponse.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .slice(0, 30000);

  const formatResponse = await Promise.race([
    client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      system: "You are a JSON formatter. Output only raw valid JSON. Start with { and end with }. No other text.",
      messages: [{ role: "user", content: `Format this content as the required JSON structure:\n\n${searchText}\n\n${prompt}` }],
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Claude API timeout (format)")), timeout)
    ),
  ]);

  const textBlock = formatResponse.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No text in response");
  const su = searchResponse.usage || {};
  const fu = formatResponse.usage || {};
  console.log(`[tokens] ${regionName} search — in:${su.input_tokens ?? '?'} out:${su.output_tokens ?? '?'}`);
  console.log(`[tokens] ${regionName} format — in:${fu.input_tokens ?? '?'} out:${fu.output_tokens ?? '?'}`);
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
  return EN_STRINGS;
}

// ─── HTML rendering ───────────────────────────────────────────────────────────

function ddgUrl(query) {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}

function renderItem(item, t, locale = 'en') {
  const regionalGeos = ["Spain", "Norway", "UK", "United Kingdom", "Netherlands"];
  const isRegional = regionalGeos.includes(item.geo);
  const pillClass = isRegional ? "geo-pill regional" : "geo-pill";
  const dotClass = isRegional ? "dot dot-regional" : "dot dot-global";
  const searchQuery = isRegional
    ? encodeURIComponent(item.headline + " " + item.geo)
    : encodeURIComponent(item.headline);
  const geoLabel = item.geo;

  return `  <div class="item">
    <div class="${dotClass}"></div>
    <div class="item-body">
      <div class="item-head">${item.headline}</div>
      <div class="item-text">${item.body}</div>
      <div class="item-foot">
        <span class="${pillClass}">${geoLabel}</span>
        <a class="search-link" href="https://duckduckgo.com/?q=${searchQuery}" target="_blank">↗</a>
        <span class="source-pill">~${item.sources} ${t.SOURCE_PILL_LABEL}<span class="src-tip">${t.SOURCE_TIP}</span></span>
      </div>
    </div>
  </div>`;
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
    `<!-- FEED:START -->\n<div class="feed">\n${allItems.map((item) => renderItem(item, t, locale)).join("\n")}\n</div>\n` +
    "<!-- FEED:END -->" +
    html.slice(feedEnd);

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
  const jsLocaleMap = { en: "en-GB" };
  html = html.replace("{{JS_LOCALE}}", jsLocaleMap[locale] || "en-GB");

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
        <a href="https://duckduckgo.com/?q=${encodeURIComponent(item.headline + (item.geo !== 'Global' ? ' ' + item.geo : ''))}" style="font-family:'Courier New',monospace;font-size:11px;color:#c8a84a;text-decoration:none;margin-right:8px;" target="_blank">&#x2197;</a>
        <span style="font-family:'Courier New',monospace;font-size:10px;color:#aaa;">~${item.sources} ${t.SOURCE_PILL_LABEL}</span>
      </div>
    </td></tr>
    <tr><td class="rp" style="padding:12px 28px 0;"><hr style="border:none;border-top:1px solid #e8e4de;margin:0;"></td></tr>`
  ).join("\n");


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
      <td><a href="https://rumbo.wtf/index.html" style="text-decoration:none;"><span style="font-family:Georgia,serif;font-size:20px;color:#f5f3ee;letter-spacing:-0.5px;">Rumbo<span style="color:#c8a84a;">.wtf</span></span></a></td>
      <td align="right"><span style="font-family:'Courier New',monospace;font-size:10px;color:#888;letter-spacing:1px;">${date}</span></td>
    </tr>
    </table>
  </td></tr>

  <!-- Spacer -->
  <tr><td style="padding:8px 0 0;"></td></tr>

  <!-- Items -->
  ${itemsHtml}

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

  // Step 1: load recent run context (last 3 days) to avoid repetition
  let previousContext = "";
  try {
    let allHeadlines = [];
    // Load rolling history file (up to 3 days)
    let recentHistory = [];
    try {
      recentHistory = JSON.parse(fs.readFileSync("recent_headlines.json", "utf8"));
    } catch (e) {
      // No history yet — start fresh
    }

    // Also load last_output.json as the most recent run
    try {
      const lastOutput = JSON.parse(fs.readFileSync("last_output.json", "utf8"));
      allHeadlines = lastOutput.items.map(i => i.headline);
    } catch (e) {}

    // Combine with history, deduplicate
    const historyHeadlines = recentHistory.flatMap(r => r.headlines || []);
    const combinedHeadlines = [...new Set([...allHeadlines, ...historyHeadlines])];

    if (combinedHeadlines.length > 0) {
      previousContext = `\nThe following stories have appeared in recent editions. Do not repeat the same topics, angles, or entities — find what is genuinely new. Do not return to the same ongoing conflict or country situation even under a new angle, if it appeared in any of these recent editions:\n${combinedHeadlines.map(h => `- ${h}`).join("\n")}\n`;
    }

    console.log(`Loaded deduplication context: ${combinedHeadlines.length} headlines from last ${recentHistory.length + 1} runs.`);
  } catch (e) {
    console.log("No previous run context found — first run.");
  }

  // Step 2: global call — runs once, shared across all editions
  console.log("Calling Claude for global edition...");
  let globalData;
  try {
    const deduplicationHint = previousContext;
    const globalRaw = await callClaude(GLOBAL_PROMPT + deduplicationHint, deduplicationHint);
    globalData = parseJson(globalRaw);
    console.log(`Global: ${globalData.items.length} items`);
  } catch (e) {
    console.error("Global call failed:", e.message);
    // Fall back to last run's output rather than killing the whole process
    try {
      globalData = JSON.parse(fs.readFileSync("last_output.json", "utf8"));
      console.warn("Using last_output.json as fallback — today's content may be stale.");
    } catch (e2) {
      console.error("No fallback available:", e2.message);
      process.exit(1);
    }
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

  // Step 4: regional editions
  const allRegionalItems = {}; // { regionCode: [items] } — used by Step 7

  for (const region of REGIONS) {
    console.log(`Calling Claude for ${region.name} regional top-up...`);
    try {
      const regionalRaw = await callClaudeSinglePass(
        REGIONAL_PROMPT(region.name, JSON.stringify(globalData, null, 2)) + previousContext,
        region.name
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

    } catch (e) {
      console.error(`Regional call failed for ${region.name}:`, e.message);
      console.log(`Writing global-only EN fallback for ${region.name}.`);
      fs.writeFileSync(region.file, globalHtml, "utf8");
    }
  }

  // Step 6: save JSON outputs
  fs.writeFileSync("last_output.json", JSON.stringify(globalData, null, 2), "utf8");
  console.log("Raw JSON saved to last_output.json");

  // Update rolling 3-day headline history
  try {
    let recentHistory = [];
    try {
      recentHistory = JSON.parse(fs.readFileSync("recent_headlines.json", "utf8"));
    } catch (e) {}
    const newEntry = {
      date: dateStr,
      headlines: globalData.items.map(i => i.headline)
    };
    recentHistory.unshift(newEntry);
    recentHistory = recentHistory.slice(0, 3); // keep last 3 runs only
    fs.writeFileSync("recent_headlines.json", JSON.stringify(recentHistory, null, 2), "utf8");
    console.log(`Rolling headline history updated (${recentHistory.length} runs stored).`);
  } catch (e) {
    console.error("Failed to update recent_headlines.json:", e.message);
  }

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

    let skipped = 0;

    // Build batch payload — one object per eligible subscriber
    const batch = [];
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

      const unsubUrl = `https://rumbo.wtf/api/unsubscribe?token=${sub.unsubscribe_token}`;
      const emailHtml = renderEmail(mergedData, dateStr, "en", unsubUrl);

      batch.push({
        from: "Rumbo <brief@rumbo.wtf>",
        to: sub.email,
        subject: `Rumbo · ${dateStr}`,
        html: emailHtml,
      });
    }

    if (batch.length === 0) {
      console.log(`Newsletter done. Sent: 0, skipped (wrong day): ${skipped}.`);
    } else {
      const sendRes = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });

      if (!sendRes.ok) {
        const errBody = await sendRes.text();
        console.error(`Resend batch failed: ${errBody}`);
      } else {
        const resJson = await sendRes.json();
        console.log(`Resend batch accepted. IDs: ${resJson.data?.map(r => r.id).join(", ") ?? "n/a"}`);
      }

      console.log(`Newsletter done. Sent: ${batch.length}, skipped (wrong day): ${skipped}.`);
    }
  } catch (e) {
    console.error("Newsletter send failed:", e.message);
  }
  } // end SEND_NEWSLETTER check

  console.log("Done.");
}

main();
