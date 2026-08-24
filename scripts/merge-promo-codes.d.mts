export const GENERATED_MARKER: string;
export function normalizePromoCodeLine(line: string): string;
export function mergePromoCodeText(
  mainText: string,
  stateText: string,
  mainRef?: string,
): string;
export function mergePromoCodeFiles(
  mainPath: string,
  statePath: string,
  outputPath: string,
  mainRef?: string,
): Promise<string>;
