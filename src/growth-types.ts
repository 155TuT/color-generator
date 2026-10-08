import type { ColorDomain, GenerationResult } from './types';

export interface GrowthNode {
  id: string;
  hex: string;
  birthOrder: number;
  parentId: string | null;
  strategy: 'fixed' | 'seed' | 'bridge' | 'explore';
  distance: number | null;
  branch: number | null;
}

/** Birth order is independent of the palette's presentation order. */
export interface GrowthState {
  version: 1;
  nextOrder: number;
  nodes: GrowthNode[];
  styleDomain: ColorDomain | null;
  directions: number[];
  referenceColors: string[];
}

export interface GrowthOperation {
  kind: 'add' | 'complete' | 'randomize';
  indices?: number[];
}

export interface GrowthResult extends GenerationResult {
  growth: GrowthState;
  changedIndices: number[];
  domainMode?: 'auto' | 'manual';
}
