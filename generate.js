// Rumbo.wtf — daily generation script
// Calls Claude API (global + regional), renders one HTML file per region/language combination
// Run: node generate.js

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";

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
    culture: "Culture",
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
// noFile: Norwegian output filename (null = no Norwegian version for this region)
// Adding Norwegian for a region later = set noFile to the target filename

const REGIONS = [
  { code: "es", name: "Spain",          file: "index-es.html",  noFile: "index-spain-no.html" },
  { code: "no", name: "Norway",         file: "index-no.html",  noFile: "index-norway-no.html" },
  { code: "uk", name: "United Kingdom", file: "index-uk.html",  noFile: "index-uk-no.html" },
  { code: "nl", name: "Netherlands",    file: "index-nl.html",  noFile: "index-nl-no.html" },
];

// Global Norwegian file — generated separately from the REGIONS loop
const GLOBAL_NO_FILE = "index-global-no.html";

// ─── Prompts ──────────────────────────────────────────────────────────────────

// NOTE: Keep in sync with the prompt displayed in about.html
const GLOBAL_PROMPT = `You are the editorial engine for Rumbo.wtf, a world intelligence brief.

Search the web for the most consequential global developments from the last 72 hours.

Apply the following editorial rules:
- Select 3-4 items based on second-order consequences, not surface drama
- Write each item in plain language any curious adult can understand without prior knowledge
- No jargon: translate all technical terms, acronyms, and financial language into plain English
- Select by second-order consequences, not by volume of coverage. A development covered by three sources that shifts how hundreds of millions of people live outranks a development covered by fifty sources that affects one country's domestic politics. Actively discount story loudness as a selection criterion.
- Before finalising, ask: does this set of stories reflect only one region's news cycle? If more than two items share the same geopolitical frame, replace the weakest with the most consequential development from a different part of the world.
- Apply a genuine global lens. Before finalising, ask: does this selection reflect only the most-covered corners of the world? If yes, replace the weakest item with the most consequential under-reported development from elsewhere.
- No individual names in headlines unless the person is irreplaceable to the story. Lead with the institution, country, or dynamic instead.
- Never include specific prices, rates, or market figures (oil price, exchange rates, stock levels) — these change daily and will be outdated. Describe direction and magnitude qualitatively instead (e.g. "oil prices surged to historic highs" not "$110 per barrel").
- Only include items that have new developments or reporting within the last 72 hours. If a story's most recent coverage is older than 72 hours, skip it regardless of significance.
- Never include time references like "this week", "on Friday", "recently", or "announced today" in headlines or body text unless you can verify the exact date from a source. Use the factual content only — the freshness is implied by the 72-hour rule.
- Exactly two sentences per item. Count the words — each sentence must be 20 words or fewer. Cut ruthlessly: what actually shifted, and how it moves the world.
- Geo tag each item: Global / Europe / Asia / Africa / Americas / Oceania
- For each item, count the number of genuinely independent source clusters (organisations that did their own reporting, not syndication of the same wire). Include this as a "sources" integer. Do not count outlets republishing the same wire service as independent sources.
- You MUST include exactly 4 Meanwhile items, one for EACH of these four categories in this exact order: culture, science_tech, wellbeing, worldviews. All four are required every time.
- Meanwhile = things worth knowing, not current headlines. Each item maximum 15 words, no analysis.
- Meanwhile items must not repeat, reference, or summarise any story, person, event, or entity already included in the main feed items above. If a person, group, country, or event appears in the main feed, it cannot appear in Meanwhile even from a different angle.
- Meanwhile items must reflect something genuinely new or newly reported within the last 72 hours, not established facts or old studies being recycled.
- Each Meanwhile item must include a "search" field with a good DuckDuckGo search query for that item.
- Culture: the lighter side of being human — sport, art, entertainment
- Science_tech: what is becoming possible
- Wellbeing: health, medicine, longevity — how people are living
- Worldviews: belief systems, ideological shifts, religious movements, or political culture — how groups define themselves and others. Not news events, not disasters, not policy outcomes.
- Alien-observer neutrality: no home team, no ideology, describe what actors do not whether they are right
- Avoid passive voice that hides agency

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

Search the web for the 1-2 most consequential developments in ${regionName} from the last 72 hours that are NOT already covered in the global edition above.

Rules:
- Only include items genuinely specific to ${regionName} and not already represented in the global feed
- Same format as global items: plain language, two sentences, no individual names in headlines
- Exactly two sentences per item. Each sentence must be 20 words or fewer. Cut ruthlessly.
- Never include specific figures (monetary amounts, percentages, casualty counts) unless they appear in multiple independent sources. If uncertain, describe impact qualitatively instead.
- Only include items that have new developments or reporting within the last 72 hours. If a story's most recent coverage is older than 72 hours, skip it regardless of significance.
- Before including any item, verify the publication date of your sources. If you cannot find a source dated within the last 72 hours, do not include that item.
- For each item, the newness must be concrete: a vote that happened, a statement made, a figure released, an event that occurred — all within the last 72 hours. Do not include ongoing situations unless something specific changed in that window.
- If you cannot find 1-2 genuinely fresh items for this region, return only one item — the most recent thing you can verify — rather than padding with older stories.
- Never include time references like "this week", "on Friday", "recently", or "announced today" in headlines or body text unless you can verify the exact date from a source. Use the factual content only — the freshness is implied by the 72-hour rule.
- Before including any item, verify the publication date of your sources. If you cannot find a source dated within the last 72 hours, do not include that item.
- For each item, the newness must be concrete: a vote that happened, a statement made, a figure released, an event that occurred — all within the last 72 hours. Do not include ongoing situations unless something specific changed in that window.
- If you cannot find 1-2 genuinely fresh items for this region, return only one item — the most recent thing you can verify — rather than padding with older stories.
- Count independent source clusters per item
- You MUST return at least one item. If no major developments exist, include the most noteworthy ${regionName} story from the last 72 hours even if smaller in scale than the global items.

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

const TRANSLATE_PROMPT = (langName, contentJson) =>
  `Translate the following Rumbo.wtf JSON content into ${langName}.

Rules:
- Translate ONLY the string values of: "headline" and "body" in items; "text" in meanwhile items
- Do NOT translate: JSON keys, "geo" values, "category" values, "search" field values, integers
- Write as if originally authored in ${langName} — natural phrasing, not word-for-word translation
- Keep headlines punchy and direct
- Preserve the same sentence structure and brevity as the original
- Preserve all punctuation conventions and em-dashes

CRITICAL: Return ONLY the raw JSON object with the exact same structure as the input. Start with { and end with }. No other text.

${contentJson}`;

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
  const jsLocaleMap = { en: "en-GB", no: "nb-NO", es: "es-ES" };
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

async function main() {
  console.log("Rumbo generator starting...");

  // Step 1: global call — runs once, shared across all editions
  console.log("Calling Claude for global edition...");
  let globalData;
  try {
    const globalRaw = await callClaude(GLOBAL_PROMPT);
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

  // Step 2: render global EN edition
  console.log("Rendering index.html (global, EN)...");
  const globalHtml = renderHtml({ ...globalData }, dateStr, "en");
  fs.writeFileSync("index.html", globalHtml, "utf8");
  console.log("index.html written.");

  // Step 3: render global NO edition
  console.log("Translating global edition to Norwegian...");
  try {
    const globalDataNo = await translateData(globalData, "Norwegian");
    const globalNoHtml = renderHtml(globalDataNo, dateStr, "no");
    fs.writeFileSync(GLOBAL_NO_FILE, globalNoHtml, "utf8");
    console.log(`${GLOBAL_NO_FILE} written.`);
  } catch (e) {
    console.error(`Global NO translation failed: ${e.message}`);
    console.log(`Writing EN fallback for ${GLOBAL_NO_FILE}.`);
    fs.writeFileSync(GLOBAL_NO_FILE, globalHtml, "utf8");
  }

  // Step 4: regional editions
  for (const region of REGIONS) {
    console.log(`Calling Claude for ${region.name} regional top-up...`);
    try {
      const regionalRaw = await callClaude(
        REGIONAL_PROMPT(region.name, JSON.stringify(globalData, null, 2))
      );
      const regionalData = parseJson(regionalRaw);

      // Merge: global items + regional items
      const mergedData =
        regionalData.items && regionalData.items.length > 0
          ? { ...globalData, items: [...globalData.items, ...regionalData.items] }
          : { ...globalData };

      if (regionalData.items && regionalData.items.length > 0) {
        console.log(`Added ${regionalData.items.length} regional items for ${region.name}`);
      } else {
        console.log(`No regional items for ${region.name}, using global-only content.`);
      }

      // Render EN version
      const regionalHtml = renderHtml(mergedData, dateStr, "en");
      fs.writeFileSync(region.file, regionalHtml, "utf8");
      console.log(`${region.file} written.`);

      // Render NO version if configured
      if (region.noFile) {
        console.log(`Translating ${region.name} edition to Norwegian...`);
        try {
          const mergedDataNo = await translateData(mergedData, "Norwegian");
          const regionalNoHtml = renderHtml(mergedDataNo, dateStr, "no");
          fs.writeFileSync(region.noFile, regionalNoHtml, "utf8");
          console.log(`${region.noFile} written.`);
        } catch (e) {
          console.error(`NO translation failed for ${region.name}: ${e.message}`);
          console.log(`Writing EN fallback for ${region.noFile}.`);
          fs.writeFileSync(region.noFile, regionalHtml, "utf8");
        }
      }
    } catch (e) {
      console.error(`Regional call failed for ${region.name}:`, e.message);
      console.log(`Writing global-only EN fallback for ${region.name}.`);
      fs.writeFileSync(region.file, globalHtml, "utf8");
      if (region.noFile) {
        fs.writeFileSync(region.noFile, globalHtml, "utf8");
      }
    }
  }

  // Step 5: save debug JSON
  fs.writeFileSync("last_output.json", JSON.stringify(globalData, null, 2), "utf8");
  console.log("Raw JSON saved to last_output.json");
  console.log("Done.");
}

main();
