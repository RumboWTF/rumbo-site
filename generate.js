// Rumbo.wtf — daily generation script
// Calls Claude API (global + regional), renders one HTML file per region
// Run: node generate.js

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Region config ────────────────────────────────────────────────────────────
// Add new regions here — nothing else needs to change

const REGIONS = [
  { code: "es", name: "Spain",           file: "index-es.html" },
  { code: "no", name: "Norway",          file: "index-no.html" },
  { code: "uk", name: "United Kingdom",  file: "index-uk.html" },
  { code: "nl", name: "Netherlands",     file: "index-nl.html" },
];

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
- Never include specific figures (monetary amounts, percentages, casualty counts) unless they appear in multiple independent sources. If uncertain, describe impact qualitatively instead.
- Exactly two sentences per item. Count the words — each sentence must be 20 words or fewer. Cut ruthlessly: what actually shifted, and how it moves the world
- Geo tag each item: Global / Europe / Asia / Africa / Americas
- For each item, count the number of genuinely independent source clusters (organisations that did their own reporting, not syndication of the same wire). Include this as a "sources" integer. Do not count outlets republishing the same wire service as independent sources.
- You MUST include exactly 4 Meanwhile items, one for EACH of these four categories in this exact order: culture, frontiers, wellbeing, worldviews. All four are required every time.
- Meanwhile = things worth knowing, not current headlines. Each item maximum 15 words, no analysis.
- Meanwhile items must not repeat or summarise any story already included in the main feed items above.
- Each Meanwhile item must include a "search" field with a good DuckDuckGo search query for that item.
- Culture: the lighter side of being human — sport, art, entertainment
- Frontiers: science and tech — what is becoming possible
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
      "category": "culture|frontiers|wellbeing|worldviews",
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

// ─── API call ─────────────────────────────────────────────────────────────────

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

// ─── JSON parse ───────────────────────────────────────────────────────────────

function parseJson(raw) {
  const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  if (clean.startsWith("{")) return JSON.parse(clean);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1) return JSON.parse(raw.slice(start, end + 1));
  throw new Error("No JSON object found in response");
}

// ─── HTML rendering ───────────────────────────────────────────────────────────

function ddgUrl(query) {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}

function renderItem(item) {
  const regionalGeos = ["Spain", "Norway", "UK", "United Kingdom", "Netherlands"];
  const isRegional = regionalGeos.includes(item.geo);
  const pillClass = isRegional ? "geo-pill regional" : "geo-pill";
  const dotClass = isRegional ? "dot dot-regional" : "dot dot-global";
  const searchQuery = encodeURIComponent(item.headline);

  return `  <div class="item">
    <div class="${dotClass}"></div>
    <div class="item-body">
      <div class="item-head">${item.headline}</div>
      <div class="item-text">${item.body}</div>
      <div class="item-foot">
        <span class="${pillClass}">${item.geo}</span>
        <a class="search-link" href="https://duckduckgo.com/?q=${searchQuery}" target="_blank">↗</a>
        <span class="source-pill">~${item.sources} sources<span class="src-tip">Approximate number of independent source clusters found. More sources means wider reporting — not that the story is accurate.</span></span>
      </div>
    </div>
  </div>`;
}

function renderMeanwhile(items) {
  const tooltips = {
    culture: "The lighter side of being human",
    frontiers: "Science and tech — what is becoming possible",
    wellbeing: "Health, medicine, longevity — how people are living",
    worldviews: "The stories humans tell to form groups",
  };
  return items
    .map(
      (item) => `    <div class="nw-item">
      <div class="nw-top">
        <div class="nw-cat-wrap"><span class="nw-cat">${item.category}</span><div class="nw-tooltip">${tooltips[item.category] || ""}</div></div>
        <a class="nw-search" href="${ddgUrl(item.search)}" target="_blank">↗</a>
      </div>
      <span class="nw-txt">${item.text}</span>
    </div>`
    )
    .join("\n");
}

function renderHtml(data, date) {
  const allItems = data.items;
  const itemCount = allItems.length;
  const utcTime = new Date();
  const isoString = utcTime.toISOString();

  let html = fs.readFileSync("template.html", "utf8");

  const feedStart = html.indexOf("<!-- FEED:START -->");
  const feedEnd = html.indexOf("<!-- FEED:END -->") + "<!-- FEED:END -->".length;
  html =
    html.slice(0, feedStart) +
    `<!-- FEED:START -->\n<div class="feed">\n${allItems.map(renderItem).join("\n")}\n</div>\n` +
    "<!-- FEED:END -->" +
    html.slice(feedEnd);

  const mwStart = html.indexOf("<!-- MEANWHILE:START -->");
  const mwEnd = html.indexOf("<!-- MEANWHILE:END -->") + "<!-- MEANWHILE:END -->".length;
  html =
    html.slice(0, mwStart) +
    `<!-- MEANWHILE:START -->\n<div class="nw-grid">\n${renderMeanwhile(data.meanwhile)}\n  </div>\n` +
    "<!-- MEANWHILE:END -->" +
    html.slice(mwEnd);

  html = html.replace(/Last updated [^<]+/, `Last updated ${date}`);
  html = html.replace(/>\d+ items</, `>${itemCount} items<`);
  html = html.replace(
    /var utc = new Date\('[^']+'\)/,
    `var utc = new Date('${isoString}')`
  );

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

  // Step 2: render global-only edition
  console.log("Rendering index.html (global)...");
  const globalHtml = renderHtml({ ...globalData }, dateStr);
  fs.writeFileSync("index.html", globalHtml, "utf8");
  console.log("index.html written.");

  // Step 3: regional editions — one API call per region
  for (const region of REGIONS) {
    console.log(`Calling Claude for ${region.name} regional top-up...`);
    try {
      const regionalRaw = await callClaude(
        REGIONAL_PROMPT(region.name, JSON.stringify(globalData, null, 2))
      );
      const regionalData = parseJson(regionalRaw);

      if (regionalData.items && regionalData.items.length > 0) {
        // Merge: global items + regional items
        const mergedData = {
          ...globalData,
          items: [...globalData.items, ...regionalData.items],
        };
        console.log(`Added ${regionalData.items.length} regional items for ${region.name}`);
        const regionalHtml = renderHtml(mergedData, dateStr);
        fs.writeFileSync(region.file, regionalHtml, "utf8");
        console.log(`${region.file} written.`);
      } else {
        // No regional items — write global-only version for this region too
        console.log(`No regional items for ${region.name}, writing global-only version.`);
        fs.writeFileSync(region.file, globalHtml, "utf8");
      }
    } catch (e) {
      console.error(`Regional call failed for ${region.name}:`, e.message);
      // Non-fatal — write global-only version as fallback
      console.log(`Writing global-only fallback for ${region.name}.`);
      fs.writeFileSync(region.file, globalHtml, "utf8");
    }
  }

  // Step 4: save debug JSON
  fs.writeFileSync("last_output.json", JSON.stringify(globalData, null, 2), "utf8");
  console.log("Raw JSON saved to last_output.json");
  console.log("Done.");
}

main();
