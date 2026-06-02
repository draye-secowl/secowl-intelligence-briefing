import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const configPath = path.join(rootDir, "briefing.config.json");
const indexPath = path.join(rootDir, "index.html");
const archiveDir = path.join(rootDir, "briefings");

const SOURCE_ICON = `<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

const SECTION_ICONS = {
  "workplace-violence": `<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  hipaa: `<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`,
  lawsuits: `<svg viewBox="0 0 24 24"><path d="M12 3v18M8 6l-4 6h8zm8 0l-4 6h8zM3 17h7m4 0h7"/></svg>`,
  "guard-industry": `<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M8 17c1.1-2 6.9-2 8 0"/></svg>`,
  "best-practices": `<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  "human-trafficking": `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/><path d="M8 11h6M11 8v6"/></svg>`
};

const TAG_CLASS = {
  critical: "tag--critical",
  update: "tag--update",
  new: "tag--new",
  watch: "tag--watch"
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeUrl(value = "") {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "#";
  } catch {
    return "#";
  }
}

function formatDateParts(now = new Date()) {
  const displayDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(now);
  const dayName = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long"
  }).format(now);
  const dateISO = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  const generatedAt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short"
  }).format(now).replace(" EST", " ET").replace(" EDT", " ET");

  return {
    dateISO,
    dayName,
    displayDate,
    editionLabel: `${dayName} Edition`,
    generatedAt
  };
}

function getOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const textParts = [];
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) textParts.push(content.text);
    }
  }
  return textParts.join("\n");
}

function parseJsonFromText(text) {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("The model did not return valid JSON.");
  }
}

async function requestSectionBriefing(config, section, dateParts) {
  if (process.env.MOCK_BRIEFING === "1") {
    return {
      sectionId: section.id,
      stories: [
        {
          status: "watch",
          source: "Mock source for testing",
          time: "Test run",
          title: `${section.title} test item`,
          summary: `This is a local test item for ${section.title}. It proves the generator can rebuild the SecOwl briefing page, update section counts, create source links, and preserve the existing design before the real OpenAI API key is added in GitHub.`,
          url: "https://example.com/",
          crossRefs: [],
          isCritical: false
        }
      ],
      trendWatch: section.includeTrendWatch
        ? {
            note: "Reported/detected figures, not total prevalence",
            items: [
              { label: "United States", value: "Test", sub: "Mock trend figure for local testing.", barValue: "100%", sourceName: "Mock source", sourceUrl: "https://example.com/" },
              { label: "New York", value: "Test", sub: "Mock trend figure for local testing.", barValue: "48%", sourceName: "Mock source", sourceUrl: "https://example.com/" },
              { label: "Worldwide", value: "Test", sub: "Mock trend figure for local testing.", barValue: "62%", sourceName: "Mock source", sourceUrl: "https://example.com/" }
            ]
          }
        : null
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY. Add it in GitHub Settings -> Secrets and variables -> Actions.");
  }

  const model = process.env.OPENAI_MODEL || "gpt-5";
  const prompt = [
    `Today is ${dateParts.displayDate}. Create the "${section.title}" section for the SecOwl Inc. Intelligence Briefing.`,
    config.searchWindow,
    `Focus: ${section.focus}`,
    `Preferred source domains and source types: ${section.preferredSources.join(", ")}`,
    `Return ${config.targetStoriesPerSection} to ${config.maxStoriesPerSection} items only when there are real, source-backed developments. If there are no strong items, return an empty stories array.`,
    "Every story must have a working source URL from a credible source. Do not invent events, quotes, case numbers, settlements, laws, or statistics.",
    "Use U.S. focus unless the section says a major international item is relevant.",
    "For each story, explain why it matters for a security, healthcare, university, privacy, compliance, or investigation professional.",
    section.includeTrendWatch
      ? "Also return trendWatch with United States, New York, and Worldwide reported/detected figures. Prefer National Human Trafficking Hotline, HHS, DOJ, State Department, and UNODC. Include source names and URLs. Make clear these are reported/detected figures, not total prevalence."
      : "Do not return trendWatch.",
    "Return ONLY JSON in this shape:",
    `{
  "sectionId": "${section.id}",
  "stories": [
    {
      "status": "critical | update | new | watch",
      "source": "Source name",
      "time": "short age or publication date",
      "title": "story headline",
      "summary": "90 to 140 words, plain English",
      "url": "https://...",
      "crossRefs": ["optional related section names"],
      "isCritical": false
    }
  ],
  "trendWatch": {
    "note": "Reported/detected figures, not total prevalence",
    "items": [
      {"label": "United States", "value": "...", "sub": "...", "barValue": "100%", "sourceName": "...", "sourceUrl": "https://..."},
      {"label": "New York", "value": "...", "sub": "...", "barValue": "48%", "sourceName": "...", "sourceUrl": "https://..."},
      {"label": "Worldwide", "value": "...", "sub": "...", "barValue": "62%", "sourceName": "...", "sourceUrl": "https://..."}
    ]
  }
}`
  ].join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      tools: [
        {
          type: "web_search",
          user_location: {
            type: "approximate",
            country: "US",
            region: "New York",
            timezone: "America/New_York"
          }
        }
      ],
      tool_choice: "auto",
      include: ["web_search_call.action.sources"],
      input: prompt
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`OpenAI request failed for ${section.title}: ${response.status} ${details}`);
  }

  const data = parseJsonFromText(getOutputText(await response.json()));
  const stories = Array.isArray(data.stories) ? data.stories.slice(0, config.maxStoriesPerSection) : [];

  return {
    sectionId: section.id,
    stories: stories.filter((story) => story && story.title && story.summary && story.url),
    trendWatch: data.trendWatch || null
  };
}

function renderStory(story) {
  const status = String(story.status || "new").toLowerCase();
  const tagClass = TAG_CLASS[status] || TAG_CLASS.new;
  const crossRefs = Array.isArray(story.crossRefs) ? story.crossRefs.filter(Boolean) : [];
  const crossRefHtml = crossRefs.length
    ? `<span class="cross-ref">
            <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
            Also relevant to: ${escapeHtml(crossRefs.join(", "))}
          </span>`
    : "<span></span>";

  return `<div class="story">
        <div class="story__meta">
          <span class="tag ${tagClass}">${escapeHtml(status[0].toUpperCase() + status.slice(1))}</span>
          <span class="story__source">${escapeHtml(story.source || "Source")}</span>
          <span class="story__time">${escapeHtml(story.time || "Today")}</span>
        </div>
        <h2 class="story__title">${escapeHtml(story.title)}</h2>
        <p class="story__body">${escapeHtml(story.summary)}</p>
        <div class="story__footer">
          ${crossRefHtml}
          <a href="${safeUrl(story.url)}" class="source-link" target="_blank" rel="noopener noreferrer">Read source ${SOURCE_ICON}</a>
        </div>
      </div>`;
}

function renderTrendWatch(trendWatch) {
  if (!trendWatch || !Array.isArray(trendWatch.items) || trendWatch.items.length === 0) return "";
  const cards = trendWatch.items.slice(0, 3).map((item) => `<div class="trend-card">
            <div class="trend-card__label">${escapeHtml(item.label)}</div>
            <div class="trend-card__value">${escapeHtml(item.value)}</div>
            <div class="trend-card__sub">${escapeHtml(item.sub)}</div>
            <div class="trend-bar"><span class="trend-bar__fill" style="--bar-value: ${escapeHtml(item.barValue || "50%")}"></span></div>
          </div>`).join("\n");
  const sources = trendWatch.items
    .filter((item) => item.sourceName && item.sourceUrl)
    .map((item) => `<a href="${safeUrl(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.sourceName)}</a>`)
    .join(" · ");

  return `<div class="trend-watch">
        <div class="trend-watch__head">
          <div class="trend-watch__title">Human Trafficking Trend Watch</div>
          <div class="trend-watch__note">${escapeHtml(trendWatch.note || "Reported/detected figures, not total prevalence")}</div>
        </div>
        <div class="trend-grid">
          ${cards}
        </div>
        <div class="trend-watch__source">
          Sources refreshed by generator: ${sources || "source links unavailable"}
        </div>
      </div>`;
}

function renderSection(config, section, generatedSection) {
  const stories = generatedSection?.stories || [];
  const countLabel = stories.length === 1 ? "1 story" : `${stories.length} stories`;
  const emptyHtml = `<div class="empty-state">
        <strong>No new reportable events</strong>
        <span>${escapeHtml(config.emptySectionMessage)}</span>
      </div>`;

  return `<article class="section-card ${section.className}" id="${escapeHtml(section.id)}" data-target-stories="${config.targetStoriesPerSection}" data-max-stories="${config.maxStoriesPerSection}" data-empty-message="${escapeHtml(config.emptySectionMessage)}">
      <div class="section-head">
        <div class="section-head__bar"></div>
        <div class="section-head__icon">
          ${SECTION_ICONS[section.id] || ""}
        </div>
        <div class="section-head__text">
          <div class="section-head__title">${escapeHtml(section.title)}</div>
          <div class="section-head__sub">${escapeHtml(section.subtitle)}</div>
        </div>
        <div class="section-head__count">${countLabel}</div>
      </div>

      ${section.includeTrendWatch ? renderTrendWatch(generatedSection?.trendWatch) : ""}
      ${stories.length ? stories.map(renderStory).join("\n\n      ") : emptyHtml}
    </article>`;
}

function renderStatsNav(config, generatedSections) {
  return `<nav class="stats-nav" aria-label="Jump to section">
  <div class="stats-nav__inner">
    ${config.sections.map((section) => {
      const count = generatedSections.get(section.id)?.stories?.length || 0;
      return `<a href="#${escapeHtml(section.id)}" class="stat-tab ${section.statClass}">
      <div class="stat-tab__num">${count}</div>
      <div class="stat-tab__label">${escapeHtml(section.shortLabel)}</div>
    </a>`;
    }).join("\n    ")}
  </div>
</nav>`;
}

function renderSidebar(config, generatedSections, alerts, archiveLinks) {
  const toc = config.sections.map((section) => {
    const count = generatedSections.get(section.id)?.stories?.length || 0;
    return `<a href="#${escapeHtml(section.id)}" class="toc-link">
          <div class="toc-dot" style="background: ${section.tocColor}"></div>
          <span class="toc-link__label">${escapeHtml(section.shortLabel)}</span>
          <span class="toc-link__count">${count}</span>
        </a>`;
  }).join("\n        ");

  const alertHtml = alerts.length ? alerts.map((alert) => `<div class="alert-item">
          <div class="alert-dot" style="background: ${alert.color}"></div>
          <div class="alert-item__text"><strong>${escapeHtml(alert.label)}:</strong> ${escapeHtml(alert.text)}</div>
        </div>`).join("\n        ") : `<div class="alert-item">
          <div class="alert-dot" style="background: var(--text3)"></div>
          <div class="alert-item__text"><strong>No critical alerts:</strong> No new critical alerts for today's briefing.</div>
        </div>`;

  const archiveHtml = archiveLinks.length ? archiveLinks.map((archive) => `<a href="${escapeHtml(archive.href)}" class="archive-link">
          <div class="toc-dot" style="background: var(--text3); opacity: 0.5"></div>
          <span class="archive-link__label">${escapeHtml(archive.label)}</span>
          <span class="archive-link__arrow">→</span>
        </a>`).join("\n        ") : `<div class="alert-item">
          <div class="alert-dot" style="background: var(--text3)"></div>
          <div class="alert-item__text">Past briefings will appear here after the first few runs.</div>
        </div>`;

  return `<aside class="sidebar" aria-label="Briefing navigation">
    <div class="sidebar-card">
      <div class="sidebar-card__header">In this briefing</div>
      <div class="sidebar-card__body">
        ${toc}
      </div>
    </div>

    <div class="sidebar-card">
      <div class="sidebar-card__header">Today's critical alerts</div>
      <div class="sidebar-card__body">
        ${alertHtml}
      </div>
    </div>

    <div class="sidebar-card">
      <div class="sidebar-card__header">Past briefings</div>
      <div class="sidebar-card__body">
        ${archiveHtml}
      </div>
    </div>
  </aside>`;
}

async function getArchiveLinks(todayISO) {
  await fs.mkdir(archiveDir, { recursive: true });
  const files = await fs.readdir(archiveDir);
  return files
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.html$/.test(file) && file !== `${todayISO}.html`)
    .sort()
    .reverse()
    .slice(0, 5)
    .map((file) => {
      const iso = file.replace(".html", "");
      const date = new Date(`${iso}T12:00:00Z`);
      const label = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        month: "long",
        day: "numeric",
        year: "numeric",
        weekday: "long"
      }).format(date);
      return { href: `briefings/${file}`, label };
    });
}

function getAlerts(config, generatedSections) {
  const alerts = [];
  for (const section of config.sections) {
    const sectionData = generatedSections.get(section.id);
    for (const story of sectionData?.stories || []) {
      if (story.isCritical || String(story.status || "").toLowerCase() === "critical") {
        alerts.push({
          color: section.tocColor,
          label: section.shortLabel,
          text: story.title
        });
      }
    }
  }
  return alerts.slice(0, 3);
}

function replaceBetween(html, startPattern, endPattern, replacement) {
  const start = html.search(startPattern);
  if (start < 0) throw new Error(`Could not find start pattern: ${startPattern}`);
  const afterStart = html.slice(start);
  const endRelative = afterStart.search(endPattern);
  if (endRelative < 0) throw new Error(`Could not find end pattern: ${endPattern}`);
  const end = start + endRelative;
  return `${html.slice(0, start)}${replacement}${html.slice(end)}`;
}

async function main() {
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  const template = await fs.readFile(indexPath, "utf8");
  const dateParts = formatDateParts();
  const generatedSections = new Map();

  for (const section of config.sections) {
    console.log(`Generating: ${section.title}`);
    generatedSections.set(section.id, await requestSectionBriefing(config, section, dateParts));
  }

  const totalStories = [...generatedSections.values()].reduce((sum, section) => sum + section.stories.length, 0);
  const criticalCount = [...generatedSections.values()].flatMap((section) => section.stories).filter((story) => story.isCritical || String(story.status || "").toLowerCase() === "critical").length;
  const updateCount = [...generatedSections.values()].flatMap((section) => section.stories).filter((story) => String(story.status || "").toLowerCase() === "update").length;
  const alerts = getAlerts(config, generatedSections);
  const archiveLinks = await getArchiveLinks(dateParts.dateISO);

  const headerDate = `${dateParts.dayName}, ${dateParts.displayDate} · ${dateParts.generatedAt}`;
  const hero = `<section class="hero">
  <div class="hero__inner">
    <div class="edition-badge">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      ${escapeHtml(dateParts.editionLabel)}
    </div>
    <h1 class="hero__headline">
      Good morning. Here is your<br>
      <em>Healthcare Executive Briefing</em><br>
      for ${escapeHtml(dateParts.displayDate)}.
    </h1>
    <div class="hero__meta">
      <span class="hero__meta-item"><strong>${totalStories}</strong> stories monitored</span>
      <span class="hero__meta-item"><strong>${config.sections.length}</strong> coverage areas</span>
      <span class="hero__meta-item"><strong>${criticalCount}</strong> critical alerts</span>
      <span class="hero__meta-item"><strong>${updateCount}</strong> story updates</span>
      <span class="hero__meta-item">Generated ${escapeHtml(dateParts.generatedAt)}</span>
    </div>
  </div>
</section>`;

  const mainContent = `<main class="layout" data-section-target-stories="${config.targetStoriesPerSection}" data-section-max-stories="${config.maxStoriesPerSection}" data-empty-section-message="${escapeHtml(config.emptySectionMessage)}">
  <div class="content-col">
    ${config.sections.map((section) => renderSection(config, section, generatedSections.get(section.id))).join("\n\n    ")}
  </div>

  ${renderSidebar(config, generatedSections, alerts, archiveLinks)}
</main>`;

  let output = template
    .replace(/<title>.*?<\/title>/, `<title>SecOwl Intelligence Briefing — ${escapeHtml(dateParts.displayDate)}</title>`)
    .replace(/<div class="pill">.*?<\/div>/, `<div class="pill">${escapeHtml(headerDate)}</div>`);

  output = replaceBetween(output, /<!-- ============================================================\s+HERO \/ MASTHEAD\s+============================================================ -->[\s\S]*?<section class="hero">/, /<!-- ============================================================\s+STATS NAVIGATION BAR\s+============================================================ -->/, `<!-- ============================================================
     HERO / MASTHEAD
     ============================================================ -->
${hero}


`);
  output = replaceBetween(output, /<!-- ============================================================\s+STATS NAVIGATION BAR\s+============================================================ -->[\s\S]*?<nav class="stats-nav" aria-label="Jump to section">/, /<!-- ============================================================\s+MAIN CONTENT \+ SIDEBAR\s+============================================================ -->/, `<!-- ============================================================
     STATS NAVIGATION BAR
     ============================================================ -->
${renderStatsNav(config, generatedSections)}


`);
  output = replaceBetween(output, /<!-- ============================================================\s+MAIN CONTENT \+ SIDEBAR\s+============================================================ -->[\s\S]*?<main class="layout"/, /<template id="empty-section-template">/, `<!-- ============================================================
     MAIN CONTENT + SIDEBAR
     ============================================================ -->
${mainContent}

`);

  await fs.writeFile(indexPath, output, "utf8");
  await fs.writeFile(path.join(archiveDir, `${dateParts.dateISO}.html`), output, "utf8");
  console.log(`Briefing generated with ${totalStories} stories.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
