import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { join, basename } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const args = { threshold: 0.3 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") args.input = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--threshold") args.threshold = Number.parseFloat(argv[++i]);
    else if (arg === "--help") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node extract_scenes.mjs --input <video> --output <dir> [--threshold 0.3]

Detects scene changes using ffmpeg and extracts a keyframe for each scene.
Threshold controls scene detection sensitivity (0.0 - 1.0, lower = more scenes).

Output: <dir>/scenes.json + <dir>/keyframes/scene_NNN.jpg

Requires: ffmpeg, ffprobe`);
}

async function checkDependency(name) {
  try {
    await execFileAsync("which", [name]);
    return true;
  } catch {
    return false;
  }
}

async function getVideoDuration(inputPath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    inputPath,
  ], { maxBuffer: 5 * 1024 * 1024 });

  const probe = JSON.parse(stdout);
  const duration = Number.parseFloat(probe.format?.duration ?? "0");
  const videoStream = probe.streams?.find(s => s.codec_type === "video");
  const width = videoStream?.width ?? null;
  const height = videoStream?.height ?? null;

  let fps = null;
  if (videoStream?.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split("/").map(Number);
    if (den > 0) fps = Math.round((num / den) * 100) / 100;
  }

  return { duration, width, height, fps };
}

async function detectScenes(inputPath, threshold) {
  // Use ffmpeg scene detection filter to output timestamps
  const { stderr } = await execFileAsync("ffmpeg", [
    "-i", inputPath,
    "-filter:v", `select='gt(scene,${threshold})',showinfo`,
    "-f", "null",
    "-",
  ], { maxBuffer: 50 * 1024 * 1024, timeout: 600_000 });

  // Parse showinfo output for timestamps
  const timestamps = [0]; // Always start with 0
  const lines = stderr.split("\n");
  for (const line of lines) {
    const match = line.match(/pts_time:(\d+\.?\d*)/);
    if (match) {
      const ts = Number.parseFloat(match[1]);
      if (ts > 0) timestamps.push(ts);
    }
  }

  return timestamps.sort((a, b) => a - b);
}

async function extractKeyframe(inputPath, timestamp, outputPath) {
  await execFileAsync("ffmpeg", [
    "-ss", String(timestamp),
    "-i", inputPath,
    "-frames:v", "1",
    "-q:v", "2",
    "-y",
    outputPath,
  ], { timeout: 30_000 });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (!args.input) {
    throw new Error("missing --input");
  }

  const outputDir = args.output || `/tmp/film-breakdown/${basename(args.input, ".mp4")}`;
  const keyframeDir = join(outputDir, "keyframes");
  await fs.mkdir(keyframeDir, { recursive: true });

  for (const dep of ["ffmpeg", "ffprobe"]) {
    if (!(await checkDependency(dep))) {
      console.log(JSON.stringify({
        error: `${dep} not found`,
        suggestion: `install ${dep}: brew install ffmpeg`,
      }));
      process.exit(1);
    }
  }

  const videoInfo = await getVideoDuration(args.input);
  const timestamps = await detectScenes(args.input, args.threshold);

  // Build scene list with start/end times
  const scenes = [];
  for (let i = 0; i < timestamps.length; i++) {
    const start = timestamps[i];
    const end = i + 1 < timestamps.length ? timestamps[i + 1] : videoInfo.duration;
    const keyframeName = `scene_${String(i).padStart(3, "0")}.jpg`;
    const keyframePath = join(keyframeDir, keyframeName);

    await extractKeyframe(args.input, start, keyframePath);

    scenes.push({
      index: i,
      start: Math.round(start * 1000) / 1000,
      end: Math.round(end * 1000) / 1000,
      duration: Math.round((end - start) * 1000) / 1000,
      keyframe: `keyframes/${keyframeName}`,
    });
  }

  const result = {
    version: 1,
    source: {
      path: args.input,
      duration_seconds: videoInfo.duration,
      resolution: videoInfo.width && videoInfo.height
        ? `${videoInfo.width}x${videoInfo.height}`
        : null,
      fps: videoInfo.fps,
    },
    threshold: args.threshold,
    scene_count: scenes.length,
    scenes,
  };

  const outputPath = join(outputDir, "scenes.json");
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

await main();
