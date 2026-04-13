import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { join, basename, extname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") args.input = argv[++i];
    else if (arg === "--srt") args.srt = argv[++i];
    else if (arg === "--ass") args.ass = argv[++i];
    else if (arg === "--vtt") args.vtt = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--help") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node extract_subtitles.mjs --input <video> [--srt <file>] [--ass <file>] [--vtt <file>] [--output <dir>]

Extracts subtitles from a video file or parses external subtitle files.

Priority:
  1. External subtitle file (--srt, --ass, --vtt)
  2. Embedded subtitle stream (extracted via ffmpeg)

Output: <dir>/subtitles.json`);
}

// --- SRT Parser ---
function parseSrt(text) {
  const blocks = text.trim().split(/\n\s*\n/);
  const subs = [];

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

    const timeLine = lines.find(l => l.includes("-->"));
    if (!timeLine) continue;

    const [startStr, endStr] = timeLine.split("-->").map(s => s.trim());
    const textLines = lines.slice(lines.indexOf(timeLine) + 1);
    const cleanText = textLines.join(" ").replace(/<[^>]+>/g, "").trim();

    if (!cleanText) continue;

    subs.push({
      index: subs.length,
      start: timeToSeconds(startStr),
      end: timeToSeconds(endStr),
      text: cleanText,
    });
  }

  return subs;
}

// --- ASS/SSA Parser ---
function parseAss(text) {
  const subs = [];
  const lines = text.split("\n");
  let inEvents = false;
  let formatFields = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "[Events]") {
      inEvents = true;
      continue;
    }

    if (trimmed.startsWith("[") && trimmed !== "[Events]") {
      inEvents = false;
      continue;
    }

    if (!inEvents) continue;

    if (trimmed.startsWith("Format:")) {
      formatFields = trimmed.slice(7).split(",").map(f => f.trim().toLowerCase());
      continue;
    }

    if (trimmed.startsWith("Dialogue:")) {
      const values = trimmed.slice(9).split(",");
      const startIdx = formatFields.indexOf("start");
      const endIdx = formatFields.indexOf("end");
      const textIdx = formatFields.indexOf("text");

      if (startIdx === -1 || endIdx === -1 || textIdx === -1) continue;

      // Text field may contain commas, so join everything from textIdx onward
      const rawText = values.slice(textIdx).join(",");
      const cleanText = rawText
        .replace(/\{[^}]*\}/g, "")  // Remove ASS override tags
        .replace(/\\N/g, " ")        // Replace ASS newlines
        .replace(/\\n/g, " ")
        .trim();

      if (!cleanText) continue;

      subs.push({
        index: subs.length,
        start: assTimeToSeconds(values[startIdx]?.trim()),
        end: assTimeToSeconds(values[endIdx]?.trim()),
        text: cleanText,
      });
    }
  }

  return subs;
}

// --- VTT Parser ---
function parseVtt(text) {
  // VTT is structurally similar to SRT after stripping the header
  const withoutHeader = text.replace(/^WEBVTT[^\n]*\n/, "").replace(/^NOTE[^\n]*\n(?:[^\n]+\n)*\n/gm, "");
  return parseSrt(withoutHeader);
}

// --- Time utilities ---
function timeToSeconds(timeStr) {
  // Handles both HH:MM:SS,mmm and HH:MM:SS.mmm
  const normalized = timeStr.replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return Number(h) * 3600 + Number(m) * 60 + Number.parseFloat(s);
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return Number(m) * 60 + Number.parseFloat(s);
  }
  return Number.parseFloat(timeStr) || 0;
}

function assTimeToSeconds(timeStr) {
  // ASS format: H:MM:SS.cc (centiseconds)
  if (!timeStr) return 0;
  const parts = timeStr.split(":");
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return Number(h) * 3600 + Number(m) * 60 + Number.parseFloat(s);
  }
  return 0;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

async function tryExtractEmbedded(videoPath, outputDir) {
  // Check for embedded subtitle streams
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_streams",
    "-select_streams", "s",
    videoPath,
  ], { maxBuffer: 5 * 1024 * 1024 });

  const probe = JSON.parse(stdout);
  const subStreams = probe.streams || [];

  if (subStreams.length === 0) return null;

  // Extract first subtitle stream as SRT
  const srtPath = join(outputDir, "_extracted.srt");
  await execFileAsync("ffmpeg", [
    "-i", videoPath,
    "-map", "0:s:0",
    "-f", "srt",
    "-y",
    srtPath,
  ], { timeout: 60_000 });

  const content = await fs.readFile(srtPath, "utf8");
  return { format: "srt", content, language: subStreams[0]?.tags?.language || null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const outputDir = args.output || `/tmp/film-breakdown/${args.input ? basename(args.input, extname(args.input)) : "unknown"}`;
  await fs.mkdir(outputDir, { recursive: true });

  let subtitles = [];
  let source = "none";
  let language = null;

  // Priority 1: external subtitle file
  if (args.srt) {
    const content = await fs.readFile(args.srt, "utf8");
    subtitles = parseSrt(content);
    source = "external_srt";
  } else if (args.ass) {
    const content = await fs.readFile(args.ass, "utf8");
    subtitles = parseAss(content);
    source = "external_ass";
  } else if (args.vtt) {
    const content = await fs.readFile(args.vtt, "utf8");
    subtitles = parseVtt(content);
    source = "external_vtt";
  } else if (args.input) {
    // Priority 2: embedded subtitles
    try {
      const embedded = await tryExtractEmbedded(args.input, outputDir);
      if (embedded) {
        subtitles = parseSrt(embedded.content);
        source = "embedded";
        language = embedded.language;
      }
    } catch {
      // No embedded subtitles or extraction failed
    }
  }

  // Round timestamps
  subtitles = subtitles.map(s => ({
    ...s,
    start: round3(s.start),
    end: round3(s.end),
  }));

  const result = {
    version: 1,
    source,
    language,
    count: subtitles.length,
    subtitles,
  };

  const outputPath = join(outputDir, "subtitles.json");
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

await main();
