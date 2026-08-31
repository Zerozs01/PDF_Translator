import { BBox, OCRLine, OCREngine, OCRPageResult } from '../../../types';
import { OCRPreviewMode, OCRTranslationCacheEntry } from '../../../stores/useOCRTextLayerStore';

export type OverlayPalette = {
  textColor: string;
  backgroundColor: string;
  borderColor: string;
  sourceConfidence: number;
};

export type OverlayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type OverlayLayoutProfile = 'manga' | 'document' | 'general';

export type OverlayAlignment = 'center' | 'left' | 'right';

export type OverlayTypography = {
  fontSize: number;
  lineHeight: number;
  padX: number;
  padY: number;
  forceSingleLine: boolean;
  estimatedLines: number;
  contentHeight: number;
};

export type OverlayLayout = {
  rect: OverlayRect;
  typography: OverlayTypography;
  alignment: OverlayAlignment;
  effectiveProfile: OverlayLayoutProfile;
  styleKind: 'dialogue' | 'narration' | 'caption' | 'bubble';
  sharedTextStartX?: number;
  sharedCenterX?: number;
  sharedBoxLeftX?: number;
  renderText?: string;
  hidden?: boolean;
  preserveMaskWhenHidden?: boolean;
  highlightContinuationText?: string;
  highlightTextColorSourceIndex?: number;
};

export type OverlayTypographyInput = {
  index: number;
  text: string;
  bbox: BBox;
  sourceText?: string;
  profile?: OverlayLayoutProfile;
  rawConfidence?: number;
  isSingleCharacter?: boolean;
  balloonId?: number;
};

export type TranslationOverlayContext = {
  previewMode: OCRPreviewMode;
  targetTranslation: OCRTranslationCacheEntry | null;
  activeCacheKey: string;
};
