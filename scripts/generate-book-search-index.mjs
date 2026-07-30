import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = path.join(repositoryRoot, "data", "book-manifest.json");
const indexPath = path.join(repositoryRoot, "data", "book-search-index.json");
const mode = process.argv[2] || "check";
const htmlPathPattern = /^[a-z0-9-]+\.html$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function decodeEntities(value) {
  const named = new Map([
    ["amp", "&"],
    ["apos", "'"],
    ["gt", ">"],
    ["lt", "<"],
    ["nbsp", " "],
    ["ndash", "–"],
    ["quot", "\""]
  ]);

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return named.get(entity.toLowerCase()) ?? match;
  });
}

function plainText(value) {
  return decodeEntities(
    value
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

class LiteralParser {
  constructor(source, label) {
    this.source = source;
    this.label = label;
    this.index = 0;
  }

  error(message) {
    throw new Error(`${this.label}: ${message} at character ${this.index}`);
  }

  skipTrivia() {
    while (this.index < this.source.length) {
      if (/\s/.test(this.source[this.index])) {
        this.index += 1;
        continue;
      }
      if (this.source.startsWith("//", this.index)) {
        const lineEnd = this.source.indexOf("\n", this.index + 2);
        this.index = lineEnd < 0 ? this.source.length : lineEnd + 1;
        continue;
      }
      if (this.source.startsWith("/*", this.index)) {
        const commentEnd = this.source.indexOf("*/", this.index + 2);
        if (commentEnd < 0) this.error("Unterminated block comment");
        this.index = commentEnd + 2;
        continue;
      }
      break;
    }
  }

  consume(expected) {
    this.skipTrivia();
    if (this.source[this.index] !== expected) {
      this.error(`Expected "${expected}"`);
    }
    this.index += 1;
  }

  parseString() {
    this.skipTrivia();
    const quote = this.source[this.index];
    if (!["\"", "'", "`"].includes(quote)) this.error("Expected a string");
    this.index += 1;
    let result = "";

    while (this.index < this.source.length) {
      const character = this.source[this.index];
      this.index += 1;
      if (character === quote) return result;
      if (quote === "`" && character === "$" && this.source[this.index] === "{") {
        this.error("Template interpolation is not allowed in practice data");
      }
      if (character !== "\\") {
        result += character;
        continue;
      }

      if (this.index >= this.source.length) this.error("Unterminated escape");
      const escape = this.source[this.index];
      this.index += 1;
      const simpleEscapes = {
        "0": "\0",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        v: "\v"
      };
      if (Object.hasOwn(simpleEscapes, escape)) {
        result += simpleEscapes[escape];
      } else if (escape === "\n") {
        // JavaScript line continuation.
      } else if (escape === "\r") {
        if (this.source[this.index] === "\n") this.index += 1;
      } else if (escape === "x") {
        const digits = this.source.slice(this.index, this.index + 2);
        if (!/^[0-9a-f]{2}$/i.test(digits)) this.error("Invalid hexadecimal escape");
        result += String.fromCodePoint(Number.parseInt(digits, 16));
        this.index += 2;
      } else if (escape === "u") {
        if (this.source[this.index] === "{") {
          const end = this.source.indexOf("}", this.index + 1);
          if (end < 0) this.error("Invalid Unicode escape");
          const digits = this.source.slice(this.index + 1, end);
          if (!/^[0-9a-f]+$/i.test(digits)) this.error("Invalid Unicode escape");
          result += String.fromCodePoint(Number.parseInt(digits, 16));
          this.index = end + 1;
        } else {
          const digits = this.source.slice(this.index, this.index + 4);
          if (!/^[0-9a-f]{4}$/i.test(digits)) this.error("Invalid Unicode escape");
          result += String.fromCodePoint(Number.parseInt(digits, 16));
          this.index += 4;
        }
      } else {
        result += escape;
      }
    }
    this.error("Unterminated string");
  }

  parseIdentifier() {
    this.skipTrivia();
    const match = this.source.slice(this.index).match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (!match) this.error("Expected an identifier");
    this.index += match[0].length;
    return match[0];
  }

  parseNumber() {
    this.skipTrivia();
    const match = this.source
      .slice(this.index)
      .match(/^-?(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/);
    if (!match) this.error("Expected a number");
    this.index += match[0].length;
    return Number(match[0]);
  }

  parseArray() {
    const result = [];
    this.consume("[");
    this.skipTrivia();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (this.index < this.source.length) {
      result.push(this.parseValue());
      this.skipTrivia();
      if (this.source[this.index] === "]") {
        this.index += 1;
        return result;
      }
      this.consume(",");
      this.skipTrivia();
      if (this.source[this.index] === "]") {
        this.index += 1;
        return result;
      }
    }
    this.error("Unterminated array");
  }

  parseObject() {
    const result = Object.create(null);
    this.consume("{");
    this.skipTrivia();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (this.index < this.source.length) {
      this.skipTrivia();
      const key = ["\"", "'", "`"].includes(this.source[this.index])
        ? this.parseString()
        : this.parseIdentifier();
      this.consume(":");
      result[key] = this.parseValue();
      this.skipTrivia();
      if (this.source[this.index] === "}") {
        this.index += 1;
        return result;
      }
      this.consume(",");
      this.skipTrivia();
      if (this.source[this.index] === "}") {
        this.index += 1;
        return result;
      }
    }
    this.error("Unterminated object");
  }

  parseValue() {
    this.skipTrivia();
    const character = this.source[this.index];
    if (character === "{") return this.parseObject();
    if (character === "[") return this.parseArray();
    if (["\"", "'", "`"].includes(character)) return this.parseString();
    if (character === "-" || /\d/.test(character)) return this.parseNumber();
    const identifier = this.parseIdentifier();
    if (identifier === "true") return true;
    if (identifier === "false") return false;
    if (identifier === "null") return null;
    this.error(`Unsupported literal value "${identifier}"`);
  }
}

function parseAssignedLiteral(html, marker, label) {
  const markerIndex = html.indexOf(marker);
  assert(markerIndex >= 0, `${label} is missing "${marker}"`);
  const parser = new LiteralParser(
    html.slice(markerIndex + marker.length),
    label
  );
  return parser.parseValue();
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function attributeValue(attributes, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*([\"'])(.*?)\\1`, "i");
  const match = attributes.match(pattern);
  return match ? decodeEntities(match[2]) : null;
}

function reserveGeneratedId(label, usedIds) {
  const stem = `book-${slugify(label) || "section"}`;
  let candidate = stem;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${stem}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

async function loadManifest() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert(manifest?.schemaVersion === 1, "Book manifest schemaVersion must be 1");
  assert(typeof manifest.title === "string" && manifest.title.trim(), "Book title is required");
  assert(Array.isArray(manifest.groups) && manifest.groups.length > 0, "Book groups are required");

  const groupIds = new Set();
  const paths = new Set();
  const aliases = new Set();
  const pages = [];

  for (const group of manifest.groups) {
    assert(
      typeof group.id === "string" && /^[a-z0-9-]+$/.test(group.id),
      "Each book group needs a stable lowercase id"
    );
    assert(!groupIds.has(group.id), `Duplicate book group id: ${group.id}`);
    groupIds.add(group.id);
    assert(typeof group.title === "string" && group.title.trim(), `Group ${group.id} needs a title`);
    assert(
      typeof group.description === "string" && group.description.trim(),
      `Group ${group.id} needs a description`
    );
    assert(Array.isArray(group.pages) && group.pages.length > 0, `Group ${group.id} has no pages`);

    for (const page of group.pages) {
      assert(htmlPathPattern.test(page.path), `Invalid canonical page path: ${page.path}`);
      assert(
        !paths.has(page.path) && !aliases.has(page.path),
        `Duplicate canonical page path or alias: ${page.path}`
      );
      paths.add(page.path);
      assert(typeof page.title === "string" && page.title.trim(), `${page.path} needs a title`);
      assert(typeof page.summary === "string" && page.summary.trim(), `${page.path} needs a summary`);
      assert(Array.isArray(page.keywords), `${page.path} needs a keyword array`);
      assert(
        page.keywords.every((keyword) => typeof keyword === "string" && keyword.trim()),
        `${page.path} contains an invalid keyword`
      );
      assert(Array.isArray(page.prerequisites), `${page.path} needs a prerequisites array`);

      for (const alias of page.aliases || []) {
        assert(htmlPathPattern.test(alias), `Invalid alias path: ${alias}`);
        assert(!aliases.has(alias) && !paths.has(alias), `Duplicate alias path: ${alias}`);
        aliases.add(alias);
      }
      pages.push({ ...page, groupId: group.id, groupTitle: group.title });
    }
  }

  const chapterIndexes = new Map(
    pages.map((page, index) => [page.path, index])
  );
  for (const [pageIndex, page] of pages.entries()) {
    for (const prerequisite of page.prerequisites) {
      assert(paths.has(prerequisite), `${page.path} has unknown prerequisite ${prerequisite}`);
      assert(prerequisite !== page.path, `${page.path} cannot require itself`);
      assert(
        chapterIndexes.get(prerequisite) < pageIndex,
        `${page.path} prerequisite ${prerequisite} must appear earlier in the study path`
      );
    }
    if (Object.hasOwn(page, "nextPath") && page.nextPath !== null) {
      assert(paths.has(page.nextPath), `${page.path} has unknown nextPath ${page.nextPath}`);
    }
    if (Object.hasOwn(page, "previousPath") && page.previousPath !== null) {
      assert(paths.has(page.previousPath), `${page.path} has unknown previousPath ${page.previousPath}`);
    }
  }

  const repositoryHtml = (await readdir(repositoryRoot))
    .filter((name) => name.endsWith(".html"))
    .sort();
  const expectedHtml = [...paths, ...aliases].sort();
  assert(
    JSON.stringify(repositoryHtml) === JSON.stringify(expectedHtml),
    "Book manifest canonical paths and aliases must cover every root HTML file exactly once"
  );

  return { manifest, pages };
}

function extractSearchEntries(html, page, chapterIndex) {
  const mainMatch = html.match(/<main(?:\s[^>]*)?>([\s\S]*?)<\/main\s*>/i);
  assert(mainMatch, `${page.path} has no main element`);
  const main = mainMatch[1];
  const usedIds = new Set(
    Array.from(main.matchAll(/\bid\s*=\s*(["'])(.*?)\1/gi), (match) =>
      decodeEntities(match[2])
    )
  );
  const headingPattern = /<h([23])([^>]*)>([\s\S]*?)<\/h\1\s*>/gi;
  const headings = Array.from(main.matchAll(headingPattern));
  const h1Match = main.match(/<h1([^>]*)>([\s\S]*?)<\/h1\s*>/i);
  const h1 = h1Match ? plainText(h1Match[2]) : page.title;
  const firstHeadingOffset = headings[0]?.index ?? main.length;
  const introText = plainText(main.slice(0, firstHeadingOffset)).slice(0, 4000);
  const entries = [
    {
      id: `${page.path}#`,
      path: page.path,
      anchor: "",
      chapterIndex,
      groupId: page.groupId,
      groupTitle: page.groupTitle,
      chapterTitle: page.title,
      heading: h1,
      level: 1,
      keywords: page.keywords,
      text: [page.summary, introText].filter(Boolean).join(" ")
    }
  ];

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const label = plainText(heading[3]);
    if (!label) continue;
    const explicitId = attributeValue(heading[2], "id");
    const anchor = explicitId || reserveGeneratedId(label, usedIds);
    if (explicitId) usedIds.add(explicitId);
    const contentStart = heading.index + heading[0].length;
    const contentEnd = headings[index + 1]?.index ?? main.length;
    const sectionText = plainText(main.slice(contentStart, contentEnd)).slice(0, 6000);

    entries.push({
      id: `${page.path}#${anchor}`,
      path: page.path,
      anchor,
      chapterIndex,
      groupId: page.groupId,
      groupTitle: page.groupTitle,
      chapterTitle: page.title,
      heading: label,
      level: Number(heading[1]),
      keywords: page.keywords,
      text: sectionText
    });
  }

  return entries;
}

const structuredPracticePages = new Set([
  "c-practice.html",
  "deep-learning-practice.html",
  "embedded-practice.html",
  "git-practice.html",
  "os-practice.html"
]);

function dynamicEntry(page, chapterIndex, id, anchor, heading, level, text) {
  return {
    id: `${page.path}#dynamic-${id}`,
    path: page.path,
    anchor,
    chapterIndex,
    groupId: page.groupId,
    groupTitle: page.groupTitle,
    chapterTitle: page.title,
    heading,
    level,
    keywords: page.keywords,
    text: String(text || "").replace(/\s+/g, " ").trim()
  };
}

function extractStructuredPracticeEntries(html, page, chapterIndex) {
  const data = parseAssignedLiteral(
    html,
    "window.practicePageData =",
    page.path
  );
  assert(Array.isArray(data.plans), `${page.path} practice plans are invalid`);
  assert(Array.isArray(data.knowledge), `${page.path} knowledge entries are invalid`);
  assert(Array.isArray(data.groups), `${page.path} question groups are invalid`);
  assert(Array.isArray(data.resources), `${page.path} resources are invalid`);

  const entries = [];
  data.plans.forEach((item, index) => {
    assert(
      typeof item.phase === "string" &&
        typeof item.title === "string" &&
        typeof item.text === "string",
      `${page.path} has an invalid practice plan`
    );
    entries.push(
      dynamicEntry(
        page,
        chapterIndex,
        `plan-${index + 1}`,
        `practice-plan-${index + 1}`,
        `${item.phase}: ${item.title}`,
        3,
        item.text
      )
    );
  });

  data.knowledge.forEach((item, index) => {
    assert(
      typeof item.title === "string" && typeof item.text === "string",
      `${page.path} has an invalid knowledge entry`
    );
    entries.push(
      dynamicEntry(
        page,
        chapterIndex,
        `knowledge-${index + 1}`,
        `practice-knowledge-${index + 1}`,
        item.title,
        3,
        item.text
      )
    );
  });

  data.groups.forEach((group, groupIndex) => {
    assert(
      typeof group.id === "string" &&
        typeof group.title === "string" &&
        Array.isArray(group.questions),
      `${page.path} has an invalid question group`
    );
    entries.push(
      dynamicEntry(
        page,
        chapterIndex,
        `group-${group.id}`,
        group.id,
        group.title,
        3,
        `${group.questions.length} questions`
      )
    );
    group.questions.forEach((question, questionIndex) => {
      assert(
        typeof question.q === "string" &&
          Array.isArray(question.choices) &&
          question.choices.every((choice) => typeof choice === "string") &&
          typeof question.why === "string",
        `${page.path} has an invalid question`
      );
      entries.push(
        dynamicEntry(
          page,
          chapterIndex,
          `question-${groupIndex + 1}-${questionIndex + 1}`,
          `practice-question-${groupIndex + 1}-${questionIndex + 1}`,
          question.q,
          3,
          `${question.choices.join(" ")} ${question.why}`
        )
      );
    });
  });

  data.resources.forEach((resource, index) => {
    assert(
      typeof resource.title === "string" &&
        typeof resource.text === "string" &&
        Array.isArray(resource.links),
      `${page.path} has an invalid resource`
    );
    entries.push(
      dynamicEntry(
        page,
        chapterIndex,
        `resource-${index + 1}`,
        `practice-resource-${index + 1}`,
        resource.title,
        3,
        `${resource.text} ${resource.links
          .map((link) => (typeof link?.label === "string" ? link.label : ""))
          .join(" ")}`
      )
    );
  });

  return entries;
}

function extractInterviewPracticeEntries(html, page, chapterIndex) {
  const domains = parseAssignedLiteral(html, "const data =", page.path);
  assert(Array.isArray(domains), `${page.path} interview data is invalid`);
  const entries = [];

  domains.forEach((domain, domainIndex) => {
    assert(
      typeof domain.id === "string" &&
        typeof domain.title === "string" &&
        typeof domain.intro === "string" &&
        Array.isArray(domain.groups),
      `${page.path} has an invalid interview domain`
    );
    entries.push(
      dynamicEntry(
        page,
        chapterIndex,
        `domain-${domainIndex + 1}`,
        domain.id,
        domain.title,
        2,
        domain.intro
      )
    );

    domain.groups.forEach((group, groupIndex) => {
      assert(
        typeof group.name === "string" && Array.isArray(group.items),
        `${page.path} has an invalid interview group`
      );
      entries.push(
        dynamicEntry(
          page,
          chapterIndex,
          `group-${domainIndex + 1}-${groupIndex + 1}`,
          `interview-group-${domainIndex + 1}-${groupIndex + 1}`,
          group.name,
          3,
          `${domain.title} ${group.items.length} questions`
        )
      );
      group.items.forEach((item, itemIndex) => {
        assert(
          Array.isArray(item) &&
            item.length === 2 &&
            item.every((value) => typeof value === "string"),
          `${page.path} has an invalid interview question`
        );
        entries.push(
          dynamicEntry(
            page,
            chapterIndex,
            `question-${domainIndex + 1}-${groupIndex + 1}-${itemIndex + 1}`,
            `interview-question-${domainIndex + 1}-${groupIndex + 1}-${itemIndex + 1}`,
            item[0],
            3,
            item[1]
          )
        );
      });
    });
  });

  return entries;
}

function extractDynamicPracticeEntries(html, page, chapterIndex) {
  if (structuredPracticePages.has(page.path)) {
    return extractStructuredPracticeEntries(html, page, chapterIndex);
  }
  if (page.path === "interview-practice.html") {
    return extractInterviewPracticeEntries(html, page, chapterIndex);
  }
  return [];
}

async function buildIndex() {
  const { manifest, pages } = await loadManifest();
  const entries = [];
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const html = await readFile(path.join(repositoryRoot, page.path), "utf8");
    entries.push(...extractSearchEntries(html, page, index + 1));
    entries.push(...extractDynamicPracticeEntries(html, page, index + 1));
  }

  const ids = entries.map((entry) => entry.id);
  assert(new Set(ids).size === ids.length, "Generated search entries contain duplicate IDs");
  const destinations = entries.map((entry) => `${entry.path}#${entry.anchor}`);
  assert(
    new Set(destinations).size === destinations.length,
    "Generated search entries contain duplicate destinations"
  );

  return {
    schemaVersion: 1,
    manifestSchemaVersion: manifest.schemaVersion,
    chapterCount: pages.length,
    entryCount: entries.length,
    entries
  };
}

const serialized = `${JSON.stringify(await buildIndex(), null, 2)}\n`;
if (mode === "write") {
  const current = await readFile(indexPath, "utf8").catch(() => "");
  if (current.replace(/\r\n?/g, "\n") !== serialized) {
    await writeFile(indexPath, serialized, "utf8");
    console.log(`Wrote ${path.relative(repositoryRoot, indexPath)}`);
  } else {
    console.log(`Search index is already current`);
  }
} else if (mode === "check") {
  const current = await readFile(indexPath, "utf8").catch(() => "");
  if (current.replace(/\r\n?/g, "\n") !== serialized) {
    throw new Error("Book search index is stale. Run npm run build:search-index.");
  }
  const parsed = JSON.parse(current);
  console.log(
    `Verified ${parsed.entryCount} search entries across ${parsed.chapterCount} chapters`
  );
} else {
  throw new Error(`Unknown mode "${mode}". Use "write" or "check".`);
}
