import { promises as fs } from "node:fs";
import { join, dirname, basename, extname, resolve } from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--analysis") args.analysis = argv[++i];
    else if (arg === "--keyframes") args.keyframes = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--title") args.title = argv[++i];
    else if (arg === "--help") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node generate_report.mjs --analysis <markdown> --output <html> [--keyframes <dir>] [--title "..."]

Generates a self-contained HTML report from a film breakdown analysis.

  --analysis   Path to analysis markdown file
  --keyframes  Directory containing keyframe images (optional)
  --output     Output HTML file path
  --title      Report title (optional, extracted from markdown h1 if omitted)`);
}

// --- Markdown to HTML (minimal, no dependencies) ---

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMarkdown(text) {
  // Bold
  let out = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  out = out.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Inline code
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Links
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

function parseMarkdown(md, imageResolver) {
  const lines = md.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      blocks.push({ type: "heading", level, text: inlineMarkdown(text) });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line.trim())) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Image (standalone line)
    const imgMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      const alt = imgMatch[1];
      const src = imgMatch[2];
      blocks.push({ type: "image", alt, src: imageResolver(src) });
      i++;
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith("> ")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trimStart().startsWith("> ")) {
        quoteLines.push(lines[i].trimStart().slice(2));
        i++;
      }
      blocks.push({
        type: "blockquote",
        text: inlineMarkdown(quoteLines.join("\n")),
      });
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(inlineMarkdown(lines[i].replace(/^\s*[-*]\s+/, "")));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(inlineMarkdown(lines[i].replace(/^\s*\d+\.\s+/, "")));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Paragraph (collect consecutive non-empty lines)
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].trim().match(/^---+\s*$/) &&
      !lines[i].trim().match(/^!\[/) &&
      !lines[i].trimStart().startsWith("> ") &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({
        type: "paragraph",
        text: inlineMarkdown(paraLines.join("\n")),
      });
    }
  }

  return blocks;
}

function blocksToHtml(blocks) {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading": {
          const tag = `h${block.level}`;
          return `<${tag}>${block.text}</${tag}>`;
        }
        case "hr":
          return '<hr aria-hidden="true">';
        case "paragraph":
          return `<p>${block.text}</p>`;
        case "blockquote":
          return `<blockquote><p>${block.text}</p></blockquote>`;
        case "ul":
          return `<ul>${block.items.map((li) => `<li>${li}</li>`).join("")}</ul>`;
        case "ol":
          return `<ol>${block.items.map((li) => `<li>${li}</li>`).join("")}</ol>`;
        case "image":
          return `<figure><img src="${block.src}" alt="${escapeHtml(block.alt)}" loading="lazy"><figcaption>${escapeHtml(block.alt)}</figcaption></figure>`;
        default:
          return "";
      }
    })
    .join("\n");
}

// --- Image embedding ---

async function imageToBase64(filePath) {
  try {
    const data = await fs.readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : "image/jpeg";
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
}

async function resolveImages(blocks, keyframeDir) {
  for (const block of blocks) {
    if (block.type === "image" && !block.src.startsWith("data:")) {
      // Try to resolve as file path
      let filePath = block.src;
      if (keyframeDir && !filePath.startsWith("/")) {
        filePath = join(keyframeDir, basename(filePath));
      }
      const base64 = await imageToBase64(filePath);
      if (base64) {
        block.src = base64;
      }
    }
  }
}

// --- HTML template ---

function detectLanguage(text) {
  // Count CJK characters vs total
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
  const total = text.replace(/\s/g, "").length;
  return total > 0 && cjk / total > 0.15 ? "zh" : "en";
}

function generateHtml(title, bodyHtml) {
  const lang = detectLanguage(bodyHtml);
  const isCJK = lang === "zh";

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
/* --- Reset --- */
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

/* --- Page --- */
html {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

body {
  background: #f6f5f1;
  color: #1c1c1b;
  font-family: ${isCJK
    ? `"Noto Serif CJK SC", "Source Han Serif SC", "Source Han Serif",
    "Hiragino Mincho ProN", "Yu Mincho",
    "Songti SC", "SimSun",
    Georgia, "Times New Roman", serif`
    : `Georgia, "Times New Roman",
    "Noto Serif CJK SC", "Source Han Serif SC",
    "Hiragino Mincho ProN", "Songti SC", serif`};
  font-size: ${isCJK ? "17px" : "18px"};
  line-height: ${isCJK ? "1.9" : "1.7"};
  letter-spacing: ${isCJK ? "0.01em" : "0"};
}

/* --- Layout --- */
.page {
  max-width: 640px;
  margin: 0 auto;
  padding: 8vh 1.5rem 12vh;
}

/* --- Typography --- */
h1 {
  font-size: 1.75rem;
  font-weight: 600;
  line-height: 1.4;
  margin: 0 0 0.4em;
  letter-spacing: 0.04em;
}

h1::after {
  content: "";
  display: block;
  width: 2em;
  height: 1px;
  background: #1c1c1b;
  margin-top: 0.8em;
  opacity: 0.3;
}

h2 {
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1.5;
  margin: 3.5em 0 0.6em;
  letter-spacing: 0.03em;
}

h3 {
  font-size: 1.05rem;
  font-weight: 600;
  line-height: 1.5;
  margin: 2.5em 0 0.2em;
}

/* Time codes in headings rendered as subtle annotation below */
h3 code {
  display: block;
  font-size: 0.75rem;
  font-weight: 400;
  color: #8a8a86;
  margin-top: 0.3em;
  background: none;
  padding: 0;
  letter-spacing: 0.06em;
}

h4 {
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.5;
  margin: 2em 0 0.3em;
}

p {
  margin: 0 0 1.2em;
  hanging-punctuation: first allow-end last;
}

strong {
  font-weight: 600;
}

em {
  font-style: italic;
}

code {
  font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, monospace;
  font-size: 0.88em;
  background: rgba(0, 0, 0, 0.04);
  padding: 0.15em 0.35em;
  border-radius: 3px;
}

a {
  color: inherit;
  text-decoration-color: rgba(28, 28, 27, 0.25);
  text-underline-offset: 0.15em;
  transition: text-decoration-color 0.2s;
}

a:hover {
  text-decoration-color: rgba(28, 28, 27, 0.6);
}

/* --- Blockquote --- */
blockquote {
  margin: 1.8em 0;
  padding: 0 0 0 1.5em;
  border-left: 2px solid rgba(28, 28, 27, 0.12);
}

blockquote p {
  font-size: 0.95rem;
  color: #3a3a38;
  line-height: 1.85;
  margin-bottom: 0;
}

/* --- Lists --- */
ul, ol {
  margin: 0 0 1.2em;
  padding-left: 1.5em;
}

li {
  margin-bottom: 0.3em;
}

li::marker {
  color: rgba(28, 28, 27, 0.3);
}

/* --- Horizontal rule --- */
hr {
  border: none;
  height: 1px;
  background: rgba(28, 28, 27, 0.1);
  margin: 3.5em 0;
}

/* --- Images --- */
figure {
  margin: 2.8em -2rem;
  position: relative;
}

figure + figure {
  margin-top: 1.6em;
}

@media (max-width: 720px) {
  figure { margin-left: -1rem; margin-right: -1rem; }
}

figure img {
  display: block;
  width: 100%;
  height: auto;
}

figcaption {
  font-size: 0.78rem;
  color: #6b6b67;
  line-height: 1.6;
  margin-top: 0.7em;
  padding: 0 2rem;
  font-family:
    "Noto Sans CJK SC", "Source Han Sans SC",
    "Hiragino Sans", "PingFang SC",
    -apple-system, BlinkMacSystemFont,
    "Helvetica Neue", sans-serif;
  letter-spacing: 0.02em;
}

figcaption:empty {
  display: none;
}

/* --- Time codes --- */
code {
  font-variant-numeric: tabular-nums;
}

/* --- Paragraphs that lead with bold (technique entries) --- */
p > strong:first-child {
  display: inline;
}

/* More breathing room between bold-led paragraphs after the last hr */
hr ~ p {
  margin-bottom: 1.6em;
}

/* --- Print --- */
@media print {
  body { background: #fff; font-size: 11pt; }
  .page { max-width: none; padding: 0; }
  figure { margin-left: 0; margin-right: 0; break-inside: avoid; }
  h2, h3 { break-after: avoid; }
}
</style>
</head>
<body>
<article class="page">
${bodyHtml}
</article>
</body>
</html>`;
}

// --- Main ---

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (!args.analysis) {
    throw new Error("missing --analysis");
  }

  if (!args.output) {
    throw new Error("missing --output");
  }

  const md = await fs.readFile(args.analysis, "utf8");

  // Resolve keyframe directory
  const keyframeDir = args.keyframes
    ? resolve(args.keyframes)
    : dirname(resolve(args.analysis));

  // Image path resolver for markdown parsing
  const imageResolver = (src) => {
    if (src.startsWith("data:") || src.startsWith("http")) return src;
    // Keep as-is during parsing; resolve during embedding
    return src;
  };

  const blocks = parseMarkdown(md, imageResolver);

  // Embed images as base64
  const analysisDir = dirname(resolve(args.analysis));
  for (const block of blocks) {
    if (block.type === "image" && !block.src.startsWith("data:") && !block.src.startsWith("http")) {
      const src = block.src;
      // Try multiple resolution strategies
      const candidates = [
        resolve(analysisDir, src),           // relative to analysis file
        resolve(keyframeDir, src),           // relative to keyframe dir
        resolve(keyframeDir, basename(src)), // just filename in keyframe dir
        resolve(src),                        // absolute
      ];
      let embedded = false;
      for (const candidate of candidates) {
        const base64 = await imageToBase64(candidate);
        if (base64) {
          block.src = base64;
          embedded = true;
          break;
        }
      }
      if (!embedded) {
        console.error(`warning: could not embed image: ${src}`);
      }
    }
  }

  // Extract title from first h1, or use provided title
  let title = args.title || "Film Breakdown";
  const firstH1 = blocks.find((b) => b.type === "heading" && b.level === 1);
  if (firstH1) {
    title = firstH1.text.replace(/<[^>]+>/g, "");
  }

  const bodyHtml = blocksToHtml(blocks);
  const html = generateHtml(title, bodyHtml);

  await fs.mkdir(dirname(resolve(args.output)), { recursive: true });
  await fs.writeFile(args.output, html);
  console.log(JSON.stringify({ output: resolve(args.output), size: html.length }));
}

await main();
