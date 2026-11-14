import { readFile, realpath } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const UNKNOWN_DISTANCE = 12;

const FONT: Readonly<Record<string, readonly string[]>> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", ".#.#.", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", ".#.#.", "..#..", "..#..", "..#..", ".#.#.", "#...#"],
  Y: ["#...#", ".#.#.", "..#..", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "#....", "####.", "....#", "....#", "####."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
};

const ALPHABET = Object.keys(FONT).join("");
const WHITESPACE = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20]);

export interface GrayscaleCrop {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface SyntheticOcrModel {
  format: "stfc-synthetic-glyph-templates-v1";
  glyphWidth: number;
  glyphHeight: number;
  alphabet: string;
  templates: Record<string, number[][]>;
}

export interface OcrPrediction {
  text: string;
  confidence: number;
}

export type OcrField = "name" | "level";

export interface OcrAnnotation {
  sample: string;
  field: OcrField;
  crop: string;
  expected: string;
}

export interface OcrEvaluation {
  total: number;
  correct: number;
  accuracy: number;
  fields: Record<OcrField, { total: number; correct: number; accuracy: number }>;
}

function assertCrop(crop: GrayscaleCrop): void {
  if (
    !Number.isInteger(crop.width) ||
    !Number.isInteger(crop.height) ||
    crop.width < 1 ||
    crop.height < 1 ||
    crop.pixels.length !== crop.width * crop.height
  ) {
    throw new Error("Invalid grayscale crop dimensions.");
  }
}

function thresholdOtsu(pixels: Uint8Array): number {
  const histogram = new Uint32Array(256);
  for (const pixel of pixels) histogram[pixel] = (histogram[pixel] ?? 0) + 1;

  let totalSum = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    totalSum += value * (histogram[value] ?? 0);
  }

  let backgroundCount = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    const count = histogram[value] ?? 0;
    backgroundCount += count;
    if (backgroundCount === 0) continue;

    const foregroundCount = pixels.length - backgroundCount;
    if (foregroundCount === 0) break;

    backgroundSum += value * count;
    const backgroundMean = backgroundSum / backgroundCount;
    const foregroundMean = (totalSum - backgroundSum) / foregroundCount;
    const variance =
      backgroundCount *
      foregroundCount *
      (backgroundMean - foregroundMean) *
      (backgroundMean - foregroundMean);
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }
  return threshold;
}

function binarize(crop: GrayscaleCrop): Uint8Array {
  assertCrop(crop);
  const threshold = thresholdOtsu(crop.pixels);
  return Uint8Array.from(crop.pixels, (pixel) => (pixel <= threshold ? 1 : 0));
}

function normalizeGlyph(
  pixels: Uint8Array,
  width: number,
  height: number,
): number[] {
  const normalized = new Array<number>(GLYPH_WIDTH * GLYPH_HEIGHT).fill(0);
  for (let y = 0; y < GLYPH_HEIGHT; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(((y + 0.5) * height) / GLYPH_HEIGHT));
    for (let x = 0; x < GLYPH_WIDTH; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(((x + 0.5) * width) / GLYPH_WIDTH));
      normalized[y * GLYPH_WIDTH + x] = pixels[sourceY * width + sourceX] ?? 0;
    }
  }
  return normalized;
}

function renderGlyph(glyph: string, scale: number, bold = false): GrayscaleCrop {
  const pattern = FONT[glyph];
  if (!pattern) throw new Error("Unsupported synthetic glyph.");

  const width = GLYPH_WIDTH * scale;
  const height = GLYPH_HEIGHT * scale;
  const pixels = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < GLYPH_HEIGHT; y += 1) {
    for (let x = 0; x < GLYPH_WIDTH; x += 1) {
      if (pattern[y]?.[x] !== "#") continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          pixels[(y * scale + dy) * width + x * scale + dx] = 0;
          if (bold && x * scale + scale < width) {
            pixels[(y * scale + dy) * width + x * scale + scale] = 0;
          }
        }
      }
    }
  }
  return { width, height, pixels };
}

export function trainSyntheticOcrModel(): SyntheticOcrModel {
  const templates: Record<string, number[][]> = {};
  for (const glyph of ALPHABET) {
    templates[glyph] = [1, 2, 3, 4].map((variant) => {
      const syntheticSample = renderGlyph(glyph, variant === 4 ? 2 : variant, variant === 4);
      return normalizeGlyph(binarize(syntheticSample), syntheticSample.width, syntheticSample.height);
    });
  }
  return {
    format: "stfc-synthetic-glyph-templates-v1",
    glyphWidth: GLYPH_WIDTH,
    glyphHeight: GLYPH_HEIGHT,
    alphabet: ALPHABET,
    templates,
  };
}

function findGlyphRuns(binary: Uint8Array, width: number, height: number): Array<{
  left: number;
  right: number;
  top: number;
  bottom: number;
}> {
  const columns = new Uint8Array(width);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (binary[y * width + x]) columns[x] = 1;
    }
  }

  const runs: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  let x = 0;
  while (x < width) {
    while (x < width && !columns[x]) x += 1;
    if (x === width) break;
    const left = x;
    while (x < width && columns[x]) x += 1;
    const right = x - 1;
    let top = height;
    let bottom = -1;
    for (let y = 0; y < height; y += 1) {
      for (let column = left; column <= right; column += 1) {
        if (binary[y * width + column]) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    }
    runs.push({ left, right, top, bottom });
  }
  return runs;
}

function classifyGlyph(
  model: SyntheticOcrModel,
  feature: readonly number[],
): { glyph: string; confidence: number } {
  let bestGlyph = "?";
  let bestDistance = Number.POSITIVE_INFINITY;
  let secondDistance = Number.POSITIVE_INFINITY;
  for (const glyph of model.alphabet) {
    let glyphDistance = Number.POSITIVE_INFINITY;
    for (const template of model.templates[glyph] ?? []) {
      let distance = 0;
      for (let index = 0; index < feature.length; index += 1) {
        if (feature[index] !== template[index]) distance += 1;
      }
      glyphDistance = Math.min(glyphDistance, distance);
    }
    if (glyphDistance < bestDistance) {
      secondDistance = bestDistance;
      bestDistance = glyphDistance;
      bestGlyph = glyph;
    } else if (glyphDistance < secondDistance) {
      secondDistance = glyphDistance;
    }
  }
  if (bestDistance > UNKNOWN_DISTANCE) return { glyph: "?", confidence: 0 };
  const separation = Number.isFinite(secondDistance)
    ? Math.max(0, Math.min(1, (secondDistance - bestDistance) / (GLYPH_WIDTH * GLYPH_HEIGHT)))
    : 0;
  return {
    glyph: bestGlyph,
    confidence: Math.max(0, Math.min(1, 1 - bestDistance / (GLYPH_WIDTH * GLYPH_HEIGHT))) * (0.5 + separation / 2),
  };
}

export function recognizeTextCrop(
  model: SyntheticOcrModel,
  crop: GrayscaleCrop,
): OcrPrediction {
  const binary = binarize(crop);
  const runs = findGlyphRuns(binary, crop.width, crop.height);
  if (runs.length === 0) return { text: "", confidence: 0 };

  const heights = runs.map((run) => run.bottom - run.top + 1).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 1;
  const wordGapThreshold = Math.max(1, Math.floor(medianHeight * 0.8));
  let text = "";
  let confidenceTotal = 0;
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    if (!run) continue;
    const previous = runs[index - 1];
    if (previous && run.left - previous.right - 1 > wordGapThreshold) text += " ";

    const glyphWidth = run.right - run.left + 1;
    const glyphHeight = run.bottom - run.top + 1;
    const glyph = new Uint8Array(glyphWidth * glyphHeight);
    for (let y = 0; y < glyphHeight; y += 1) {
      for (let x = 0; x < glyphWidth; x += 1) {
        glyph[y * glyphWidth + x] =
          binary[(run.top + y) * crop.width + run.left + x] ?? 0;
      }
    }
    const prediction = classifyGlyph(model, normalizeGlyph(glyph, glyphWidth, glyphHeight));
    text += prediction.glyph;
    confidenceTotal += prediction.confidence;
  }
  return { text, confidence: confidenceTotal / runs.length };
}

export function renderSyntheticTextCrop(
  text: string,
  scale = 2,
): GrayscaleCrop {
  if (!Number.isInteger(scale) || scale < 1 || scale > 8) {
    throw new Error("Synthetic render scale must be an integer from 1 to 8.");
  }
  const normalizedText = text.toUpperCase();
  for (const glyph of normalizedText) {
    if (glyph !== " " && !FONT[glyph]) throw new Error("Synthetic text contains an unsupported glyph.");
  }

  const positions: Array<{ glyph: string; left: number }> = [];
  let cursor = 0;
  for (const glyph of normalizedText) {
    if (glyph === " ") {
      cursor += 4;
    } else {
      positions.push({ glyph, left: cursor });
      cursor += GLYPH_WIDTH + 1;
    }
  }
  const width = Math.max(1, cursor - (positions.length > 0 ? 1 : 0)) * scale;
  const height = GLYPH_HEIGHT * scale;
  const pixels = new Uint8Array(width * height).fill(255);
  for (const { glyph, left } of positions) {
    const pattern = FONT[glyph];
    if (!pattern) continue;
    for (let y = 0; y < GLYPH_HEIGHT; y += 1) {
      for (let x = 0; x < GLYPH_WIDTH; x += 1) {
        if (pattern[y]?.[x] !== "#") continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            pixels[(y * scale + dy) * width + (left + x) * scale + dx] = 0;
          }
        }
      }
    }
  }
  return { width, height, pixels };
}

function nextPgmToken(
  bytes: Buffer,
  start: number,
): { token: string; delimiter: number } {
  let index = start;
  while (index < bytes.length) {
    if (WHITESPACE.has(bytes[index] ?? -1)) {
      index += 1;
      continue;
    }
    if (bytes[index] === 0x23) {
      while (index < bytes.length && bytes[index] !== 0x0a && bytes[index] !== 0x0d) index += 1;
      continue;
    }
    break;
  }
  const tokenStart = index;
  while (
    index < bytes.length &&
    !WHITESPACE.has(bytes[index] ?? -1) &&
    bytes[index] !== 0x23
  ) {
    index += 1;
  }
  if (index === tokenStart) throw new Error("Invalid PGM header.");
  return { token: bytes.toString("ascii", tokenStart, index), delimiter: index };
}

export function decodePgm(bytes: Uint8Array): GrayscaleCrop {
  const buffer = Buffer.from(bytes);
  const magic = nextPgmToken(buffer, 0);
  if (magic.token !== "P5") throw new Error("Only binary 8-bit PGM (P5) crops are supported.");
  const widthToken = nextPgmToken(buffer, magic.delimiter);
  const heightToken = nextPgmToken(buffer, widthToken.delimiter);
  const maximumToken = nextPgmToken(buffer, heightToken.delimiter);
  const width = Number(widthToken.token);
  const height = Number(heightToken.token);
  const maximum = Number(maximumToken.token);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    maximum !== 255
  ) {
    throw new Error("PGM dimensions must be positive and max value must be 255.");
  }

  let pixelStart = maximumToken.delimiter;
  const delimiter = buffer[pixelStart];
  if (!WHITESPACE.has(delimiter ?? -1)) throw new Error("Invalid PGM pixel-data delimiter.");
  pixelStart += 1;
  if (delimiter === 0x0d && buffer[pixelStart] === 0x0a) pixelStart += 1;
  if (buffer.length - pixelStart !== width * height) {
    throw new Error("PGM pixel-data length does not match its dimensions.");
  }
  return { width, height, pixels: Uint8Array.from(buffer.subarray(pixelStart)) };
}

export function parseOcrAnnotations(jsonl: string): OcrAnnotation[] {
  const rows: OcrAnnotation[] = [];
  const seen = new Set<string>();
  for (const [index, rawLine] of jsonl.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`Invalid annotation JSON on line ${index + 1}.`);
    }
    if (
      typeof value !== "object" ||
      value === null ||
      !("sample" in value) ||
      !("field" in value) ||
      !("crop" in value) ||
      !("expected" in value) ||
      typeof value.sample !== "string" ||
      value.sample.length === 0 ||
      (value.field !== "name" && value.field !== "level") ||
      typeof value.crop !== "string" ||
      value.crop.length === 0 ||
      typeof value.expected !== "string" ||
      value.expected.length === 0
    ) {
      throw new Error(`Invalid annotation fields on line ${index + 1}.`);
    }
    const key = `${value.sample}\u0000${value.field}`;
    if (seen.has(key)) throw new Error(`Duplicate sample field on line ${index + 1}.`);
    seen.add(key);
    rows.push({
      sample: value.sample,
      field: value.field,
      crop: value.crop,
      expected: value.expected,
    });
  }
  if (rows.length === 0) throw new Error("Annotation manifest is empty.");
  return rows;
}

export function resolveCropPath(manifestPath: string, cropPath: string): string {
  if (isAbsolute(cropPath)) throw new Error("Crop paths must be relative to the annotation manifest.");
  const root = resolve(dirname(manifestPath));
  const candidate = resolve(root, cropPath);
  const fromRoot = relative(root, candidate);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("Crop paths must remain inside the annotation directory.");
  }
  return candidate;
}

function normalizeForComparison(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/\s+/gu, " ").trim();
}

export async function evaluateOcrAnnotations(
  annotations: readonly OcrAnnotation[],
  readCrop: (path: string) => Promise<GrayscaleCrop>,
  model = trainSyntheticOcrModel(),
): Promise<OcrEvaluation> {
  const counts: Record<OcrField, { total: number; correct: number }> = {
    name: { total: 0, correct: 0 },
    level: { total: 0, correct: 0 },
  };
  for (const annotation of annotations) {
    if (annotation.field !== "name" && annotation.field !== "level") {
      throw new Error("Unsupported OCR annotation field.");
    }
    const prediction = recognizeTextCrop(model, await readCrop(annotation.crop));
    const fieldCounts = counts[annotation.field];
    fieldCounts.total += 1;
    if (normalizeForComparison(prediction.text) === normalizeForComparison(annotation.expected)) {
      fieldCounts.correct += 1;
    }
  }
  const total = counts.name.total + counts.level.total;
  const correct = counts.name.correct + counts.level.correct;
  return {
    total,
    correct,
    accuracy: total === 0 ? 0 : correct / total,
    fields: {
      name: {
        ...counts.name,
        accuracy: counts.name.total === 0 ? 0 : counts.name.correct / counts.name.total,
      },
      level: {
        ...counts.level,
        accuracy: counts.level.total === 0 ? 0 : counts.level.correct / counts.level.total,
      },
    },
  };
}

export async function evaluateAnnotationFile(manifestPath: string): Promise<OcrEvaluation> {
  const actualManifestPath = await realpath(manifestPath);
  const manifestDirectory = await realpath(dirname(actualManifestPath));
  const rows = parseOcrAnnotations(await readFile(actualManifestPath, "utf8"));
  const model = trainSyntheticOcrModel();
  return evaluateOcrAnnotations(rows, async (relativeCropPath) => {
    const cropPath = resolveCropPath(manifestDirectory, relativeCropPath);
    const actualCropPath = await realpath(cropPath);
    const fromRoot = relative(manifestDirectory, actualCropPath);
    if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error("Crop paths must resolve inside the annotation directory.");
    }
    return decodePgm(await readFile(actualCropPath));
  }, model);
}

export function benchmarkSyntheticOcr(iterations = 2_000): {
  modelBuildMs: number;
  compressedTemplateBytes: number;
  syntheticCropsPerSecond: number;
} {
  const buildStart = performance.now();
  const model = trainSyntheticOcrModel();
  const modelBuildMs = performance.now() - buildStart;
  const compressedTemplateBytes = gzipSync(Buffer.from(JSON.stringify(model))).byteLength;
  const crop = renderSyntheticTextCrop("AB12");
  const inferenceStart = performance.now();
  for (let index = 0; index < iterations; index += 1) recognizeTextCrop(model, crop);
  const inferenceMs = Math.max(performance.now() - inferenceStart, 0.001);
  return {
    modelBuildMs,
    compressedTemplateBytes,
    syntheticCropsPerSecond: (iterations / inferenceMs) * 1_000,
  };
}

async function main(args: string[]): Promise<void> {
  if (args[0] === "evaluate" && args[1]) {
    const metrics = await evaluateAnnotationFile(args[1]);
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }
  if (args[0] === "benchmark") {
    console.log(JSON.stringify(benchmarkSyntheticOcr(), null, 2));
    return;
  }
  console.error("Usage: ocrPoc.ts evaluate <local-annotations.jsonl> | benchmark");
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => {
    console.error("OCR POC failed; crop text and local paths were not emitted.");
    process.exitCode = 1;
  });
}
