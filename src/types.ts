import type { ColorMetrics } from './color';

export interface ConstraintConfig {
  minDeltaE: number;
  maxBackgroundContrast: number;
  textColor: string;
  minTextContrast: number;
  /** Legacy API inputs without this field retain a zero lower bound. */
  minChroma?: number;
  maxChroma: number;
}

export interface ColorDomain {
  lightness: [number, number];
  chroma: [number, number];
  /** Clockwise arc in degrees; [350, 20] crosses zero and [0, 360] is the full circle. */
  hue: [number, number];
}

export interface ValidationIssue {
  code: string;
  message: string;
  indices: number[];
}

export interface PaletteValidation {
  valid: boolean;
  issues: ValidationIssue[];
  recommendations: string[];
  minDeltaE: number | null;
  maxBackgroundContrast: number;
  minTextContrast: number | null;
  maxChroma: number;
  closestPair: [number, number] | null;
  backgroundExtremes: [number, number] | null;
  textContrasts: number[];
}

export interface CandidateCheck {
  hardAllowed: boolean;
  issues: ValidationIssue[];
  recommendations: string[];
  color: ColorMetrics | null;
  validation: PaletteValidation;
}

export interface GenerateOptions {
  anchors: string[];
  /** Immutable color neighborhood guide; defaults to anchors, or the original palette for replacement. */
  styleAnchors?: string[];
  constraints: ConstraintConfig;
  domain: ColorDomain;
  seed: string | number;
  targetCount?: number;
  sampleCount?: number;
}

export type RegenerateOptions = Omit<GenerateOptions, 'anchors' | 'targetCount'>;

export interface GenerationStats {
  sampled: number;
  gamutRejected: number;
  hardRejected: number;
  uniqueCandidates: number;
  attempts: number;
}

export interface GenerationResult {
  status: 'success' | 'partial' | 'failure';
  colors: string[];
  validation: PaletteValidation;
  diagnostics: string[];
  seed: string;
  stats: GenerationStats;
  /** Partial replacement proposals are never applied to the original positions. */
  partialColors?: string[];
}
