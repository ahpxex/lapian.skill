import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--scenes") args.scenes = argv[++i];
    else if (arg === "--subtitles") args.subtitles = argv[++i];
    else if (arg === "--transcript") args.transcript = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--help") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node build_timeline.mjs --scenes <scenes.json> [--subtitles <subtitles.json>] [--transcript <transcript.json>] [--output <path>]

Merges scene data with subtitle/transcript data into a unified timeline.

Scenes define the structural backbone. Subtitles and transcripts are assigned
to scenes based on their timestamps. If both subtitles and transcripts exist,
subtitles take priority; transcript entries serve as fallback for gaps.

Output: unified timeline JSON (see references/schema.md)`);
}

async function readJsonFile(path) {
  try {
    const content = await fs.readFile(path, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function assignDialogueToScenes(scenes, subtitles, transcript) {
  // Subtitles take priority over transcript
  const primarySource = subtitles?.subtitles || [];
  const secondarySource = transcript?.transcript || [];

  // Mark which primary entries cover which time ranges
  const primaryRanges = new Set();
  for (const entry of primarySource) {
    // Mark each second covered by primary source
    for (let t = Math.floor(entry.start); t <= Math.ceil(entry.end); t++) {
      primaryRanges.add(t);
    }
  }

  // For each scene, collect dialogue entries that fall within its time range
  return scenes.map(scene => {
    const dialogue = [];

    // Add primary source entries
    for (const entry of primarySource) {
      if (entry.start >= scene.start && entry.start < scene.end) {
        dialogue.push({
          start: entry.start,
          end: entry.end,
          text: entry.text,
          source: "subtitle",
        });
      }
    }

    // Add secondary source entries only for gaps not covered by primary
    for (const entry of secondarySource) {
      if (entry.start >= scene.start && entry.start < scene.end) {
        const secondFloor = Math.floor(entry.start);
        if (!primaryRanges.has(secondFloor)) {
          dialogue.push({
            start: entry.start,
            end: entry.end,
            text: entry.text,
            source: "transcript",
            confidence: entry.confidence ?? null,
          });
        }
      }
    }

    // Sort by start time
    dialogue.sort((a, b) => a.start - b.start);

    return {
      ...scene,
      dialogue,
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (!args.scenes) {
    throw new Error("missing --scenes");
  }

  const scenesData = await readJsonFile(args.scenes);
  if (!scenesData) {
    throw new Error(`failed to read scenes file: ${args.scenes}`);
  }

  const subtitlesData = args.subtitles ? await readJsonFile(args.subtitles) : null;
  const transcriptData = args.transcript ? await readJsonFile(args.transcript) : null;

  const enrichedScenes = assignDialogueToScenes(
    scenesData.scenes,
    subtitlesData,
    transcriptData,
  );

  const timeline = {
    version: 1,
    source: scenesData.source,
    scene_count: enrichedScenes.length,
    has_subtitles: subtitlesData != null && (subtitlesData.count ?? 0) > 0,
    has_transcript: transcriptData != null && (transcriptData.count ?? 0) > 0,
    scenes: enrichedScenes,
  };

  const outputPath = args.output || join(dirname(args.scenes), "timeline.json");
  await fs.writeFile(outputPath, JSON.stringify(timeline, null, 2));
  console.log(JSON.stringify(timeline, null, 2));
}

await main();
