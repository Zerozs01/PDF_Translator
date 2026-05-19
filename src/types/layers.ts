/**
 * Layer Types — สำหรับ Position Layers feature
 * 
 * ใช้จัดการ text box layers ที่ user สามารถ edit position ได้แบบ manual
 */

import type { BBox, OCRLine } from './index';

/** Group classification */
export type LayerGroupType = 'balloon' | 'sfx' | 'narration' | 'document' | 'ungrouped';

/** A positioned text element on the canvas */
export interface TextLayer {
  id: string;
  lineIndex: number;
  groupId: string;
  text: string;
  sourceText: string;
  bbox: BBox;
  originalBBox: BBox;
  fontSize: number;
  textColor?: string;
  backgroundColor?: string;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  userEdited: boolean;
  confidence: number;
  bold?: boolean;
}

/** A group of TextLayers (e.g., one balloon/bubble) */
export interface TextLayerGroup {
  id: string;
  label: string;
  layerIds: string[];
  mergedBBox: BBox;
  collapsed: boolean;
  locked: boolean;
  visible: boolean;
  groupType: LayerGroupType;
  confidence: number;
  userCreated: boolean;
  color: string;
}

/** Grouping result from the engine */
export interface LayerGroupingResult {
  layers: TextLayer[];
  groups: TextLayerGroup[];
}
