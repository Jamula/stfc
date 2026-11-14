import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  decodePgm,
  evaluateOcrAnnotations,
  parseOcrAnnotations,
  recognizeTextCrop,
  renderSyntheticTextCrop,
  resolveCropPath,
  trainSyntheticOcrModel,
} from "../../src/crew/ocrPoc.ts";

function toPgm(crop: { width: number; height: number; pixels: Uint8Array }): Buffer {
  return Buffer.concat([
    Buffer.from(`P5\n${crop.width} ${crop.height}\n255\n`, "ascii"),
    Buffer.from(crop.pixels),
  ]);
}

describe("synthetic crop-level OCR POC", () => {
  it("derives deterministic glyph templates only from the built-in synthetic font", () => {
    const first = trainSyntheticOcrModel();
    const second = trainSyntheticOcrModel();

    assert.equal(first.format, "stfc-synthetic-glyph-templates-v1");
    assert.equal(first.alphabet.length, 36);
    assert.deepEqual(first, second);
    assert.equal(Object.keys(first.templates).length, 36);
    assert.equal(first.templates.A?.length, 4);
  });

  it("recognizes synthetic text crops at different scales and contrast levels", () => {
    const model = trainSyntheticOcrModel();
    for (const scale of [1, 2, 3]) {
      const crop = renderSyntheticTextCrop("AB 12", scale);
      const tinted = Uint8Array.from(crop.pixels, (pixel) => (pixel === 0 ? 35 : 220));

      assert.equal(recognizeTextCrop(model, { ...crop, pixels: tinted }).text, "AB 12");
    }
  });

  it("recognizes every synthetic training glyph without collapsing classes", () => {
    const model = trainSyntheticOcrModel();
    const crop = renderSyntheticTextCrop(model.alphabet);

    assert.equal(recognizeTextCrop(model, crop).text, model.alphabet);
  });

  it("decodes a local 8-bit PGM crop and rejects malformed pixel lengths", () => {
    const crop = renderSyntheticTextCrop("A1", 2);
    const decoded = decodePgm(toPgm(crop));

    assert.equal(decoded.width, crop.width);
    assert.equal(decoded.height, crop.height);
    assert.deepEqual(decoded.pixels, crop.pixels);
    assert.throws(() => decodePgm(Buffer.from("P5\n2 2\n255\n123", "ascii")), /length/i);
  });

  it("scores only annotated crop text and returns aggregate counts without transcripts", async () => {
    const annotations = parseOcrAnnotations([
      JSON.stringify({ sample: "synthetic-01", field: "name", crop: "one.pgm", expected: "ab12" }),
      JSON.stringify({ sample: "synthetic-02", field: "level", crop: "two.pgm", expected: "ZZ99" }),
    ].join("\n"));
    const crops = new Map([
      ["one.pgm", renderSyntheticTextCrop("AB12")],
      ["two.pgm", renderSyntheticTextCrop("AB12")],
    ]);

    const metrics = await evaluateOcrAnnotations(
      annotations,
      async (cropPath) => {
        const crop = crops.get(cropPath);
        if (!crop) throw new Error("Missing synthetic test crop.");
        return crop;
      },
    );

    assert.deepEqual(metrics, {
      total: 2,
      correct: 1,
      accuracy: 0.5,
      fields: {
        name: { total: 1, correct: 1, accuracy: 1 },
        level: { total: 1, correct: 0, accuracy: 0 },
      },
    });
    assert.equal("predictions" in metrics, false);
  });

  it("rejects duplicate annotations and paths escaping the manifest directory", () => {
    const row = { sample: "synthetic-01", field: "name", crop: "one.pgm", expected: "AB12" };
    const manifestPath = resolve("labels", "annotations.jsonl");
    assert.throws(
      () => parseOcrAnnotations([JSON.stringify(row), JSON.stringify(row)].join("\n")),
      /duplicate/i,
    );
    assert.throws(() => resolveCropPath(manifestPath, resolve("outside.pgm")), /relative/i);
    assert.throws(() => resolveCropPath(manifestPath, "../outside.pgm"), /inside/i);
  });
});
