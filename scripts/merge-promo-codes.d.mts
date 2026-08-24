export const GENERATED_MARKER: string;
export function normalizePromoCodeLine(line: string): string;
export function mergePromoCodeText(mainText: string, stateText: string): string;
export function mergePromoCodeFiles(
  mainPath: string,
  statePath: string,
  outputPath: string,
): Promise<string>;
