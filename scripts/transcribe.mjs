import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { join, basename, extname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const args = { model: "base" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") args.input = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--model") args.model = argv[++i];
    else if (arg === "--language") args.language = argv[++i];
    else if (arg === "--help") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node transcribe.mjs --input <video/audio> [--output <dir>] [--model base] [--language zh]

Transcribes audio using whisper (openai-whisper or whisper.cpp).

Models: tiny, base, small, medium, large
Output: <dir>/transcript.json

Requires: whisper (pip install openai-whisper) or whisper-cpp`);
}

async function checkDependency(name) {
  try {
    await execFileAsync("which", [name]);
    return true;
  } catch {
    return false;
  }
}

async function extractAudio(inputPath, outputPath) {
  await execFileAsync("ffmpeg", [
    "-i", inputPath,
    "-vn",
    "-acodec", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    "-y",
    outputPath,
  ], { timeout: 300_000 });
}

async function transcribeWithWhisper(audioPath, outputDir, model, language) {
  const cmdArgs = [
    audioPath,
    "--model", model,
    "--output_format", "json",
    "--output_dir", outputDir,
  ];

  if (language) {
    cmdArgs.push("--language", language);
  }

  await execFileAsync("whisper", cmdArgs, {
    timeout: 1_800_000, // 30 minutes for long videos
    maxBuffer: 50 * 1024 * 1024,
  });

  // whisper outputs <filename>.json in the output dir
  const jsonName = `${basename(audioPath, extname(audioPath))}.json`;
  const jsonPath = join(outputDir, jsonName);
  const content = await fs.readFile(jsonPath, "utf8");
  return JSON.parse(content);
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function convertWhisperOutput(whisperResult) {
  const segments = whisperResult.segments || [];
  return segments.map((seg, i) => ({
    index: i,
    start: round3(seg.start),
    end: round3(seg.end),
    text: seg.text.trim(),
    confidence: seg.avg_logprob != null
      ? Math.round(Math.exp(seg.avg_logprob) * 100) / 100
      : null,
    language: whisperResult.language || null,
  }));
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

  const outputDir = args.output || `/tmp/film-breakdown/${basename(args.input, extname(args.input))}`;
  await fs.mkdir(outputDir, { recursive: true });

  // Check dependencies
  const hasFfmpeg = await checkDependency("ffmpeg");
  if (!hasFfmpeg) {
    console.log(JSON.stringify({
      error: "ffmpeg not found",
      suggestion: "install ffmpeg: brew install ffmpeg",
    }));
    process.exit(1);
  }

  const hasWhisper = await checkDependency("whisper");
  if (!hasWhisper) {
    console.log(JSON.stringify({
      error: "whisper not found",
      suggestion: "install openai-whisper: pip install openai-whisper, or provide a subtitle file instead",
    }));
    process.exit(1);
  }

  // Extract audio as WAV
  const wavPath = join(outputDir, "_audio.wav");
  await extractAudio(args.input, wavPath);

  // Transcribe
  const whisperResult = await transcribeWithWhisper(wavPath, outputDir, args.model, args.language);
  const transcript = convertWhisperOutput(whisperResult);

  const result = {
    version: 1,
    source: "whisper",
    model: args.model,
    language: whisperResult.language || null,
    count: transcript.length,
    transcript,
  };

  const outputPath = join(outputDir, "transcript.json");
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2));

  // Clean up temp WAV
  try { await fs.unlink(wavPath); } catch { /* ignore */ }

  console.log(JSON.stringify(result, null, 2));
}

await main();
