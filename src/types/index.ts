export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RegionType = 'text' | 'balloon' | 'sfx' | 'panel';

export interface Region {
  id: string;
  type: RegionType;
  originalText?: string;
  translatedText?: string;
  box: Box;
}

export type ToolType = 'select' | 'hand' | 'region' | 'text';
