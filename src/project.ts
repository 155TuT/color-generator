
import {
  DEFAULT_CONSTRAINTS,
  DEFAULT_DOMAIN,
  WATERFOREST_ANCHORS,
  WATERFOREST_COLORS,
  CLAY_ANCHORS,
  CLAY_COLORS,
  CLAY_DOMAIN,
  CLAY_CONSTRAINTS,
  deriveDomainFromAnchors,
} from './presets';
import type { ColorDomain, ConstraintConfig } from './types';
import type { GrowthState } from './growth-types';
import { automaticGrowthDomain } from './sequential-growth';

export interface Project {
  version: 1;
  name: string;
  colors: string[];
  constraints: ConstraintConfig;
  domain: ColorDomain;
  seed: string;
  domainMode: 'auto' | 'manual';
  growth?: GrowthState;
}

/** Only immutable examples distinguish their representative starting colors. */
export interface ExampleProject extends Project {
  anchors: string[];
}

const emptyDomain = (): ColorDomain => ({ lightness: [0.45, 0.82], chroma: [0.02, 0.11], hue: [0, 360] });

/** A fresh session has one empty palette; a name is chosen only when saving. */
export function createProject(): Project {
  return {
    version: 1,
    name: '',
    colors: [],
    constraints: structuredClone(DEFAULT_CONSTRAINTS),
    domain: emptyDomain(),
    seed: 'palette-01',
    domainMode: 'auto',
  };
}

/** Automatic exploration follows every color currently retained in the palette. */
export function effectiveDomain(project: Project): ColorDomain {
  if (project.domainMode === 'manual') return structuredClone(project.domain);
  return automaticGrowthDomain(project);
}

/** Capture an independent calculation/export input with the current effective domain. */
export function snapshotProject(project: Project): Project {
  return { ...structuredClone(project), domain: effectiveDomain(project) };
}

/** A detached source for the read-only example viewer, never the initial workbench. */
export function makeExample(preset: 'forest' | 'clay' = 'forest'): ExampleProject {
  if (preset === 'clay') return {
    version: 1,
    name: '暮山陶土',
    anchors: [...CLAY_ANCHORS],
    colors: [...CLAY_COLORS],
    constraints: structuredClone(CLAY_CONSTRAINTS),
    domain: structuredClone(CLAY_DOMAIN),
    seed: 'clay-01',
    domainMode: 'manual',
  };
  return {
    version: 1,
    name: '水雾森林',
    anchors: [...WATERFOREST_ANCHORS],
    colors: [...WATERFOREST_COLORS],
    constraints: structuredClone(DEFAULT_CONSTRAINTS),
    domain: structuredClone(DEFAULT_DOMAIN),
    seed: 'waterforest-01',
    domainMode: 'manual',
  };
}

