/**
 * Stable Vision Worker — Reliable OCR without complex heuristics
 *
 * Based on the proven-stable temp_working_worker.ts.
 * Self-contained: only imports tesseract.js so the module-level import chain
 * cannot cause WASM-level crashes.
 *
 * Handles message types:
 *   INIT             → initialise Tesseract engine
 *   OCR_FOR_TEXT_LAYER → word-level OCR for searchable-PDF / text overlay
 *   SEGMENT          → simple region detection for panel view
 */

import { createWorker, PSM, OEM } from 'tesseract.js';

// ─── Types (duplicated intentionally — keep self-contained) ───

interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TesseractResult {
  data: {
    text: string;
    confidence: number;
    blocks?: Array<{ text: string; confidence: number; bbox: BBox }>;
    lines?: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }>;
    words?: Array<{ text: string; confidence: number; bbox: BBox }>;
    hocr?: string;
    tsv?: string;
  };
}

type DocumentType = 'manga' | 'document';

// ─── State ───

let tesseractWorker: Awaited<ReturnType<typeof createWorker>> | null = null;
let currentLang = '';
let isInitializing = false;

// ─── Config ───

const CONFIG = {
  CORE_PATH: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core.wasm.js',
  MIN_CONFIDENCE: 20,
  BALLOON_ASPECT_RATIO_MIN: 0.3,
  BALLOON_ASPECT_RATIO_MAX: 3.5,
  SFX_MIN_FONT_SIZE_RATIO: 0.1,
  SFX_MAX_WORDS: 3,
};

// ─── Helpers ───

function sendProgress(status: string, progress: number, workerId?: string): void {
  self.postMessage({
    type: 'OCR_PROGRESS',
    payload: { status, progress, workerId },
  });
}

/**
 * Get image dimensions without heavy pixel processing.
 * Uses createImageBitmap (available in Workers) to read width/height.
 */
async function getImageDimensions(imageUrl: string): Promise<{ width: number; height: number }> {
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  const bmp = await createImageBitmap(blob);
  const { width, height } = bmp;
  bmp.close();
  return { width, height };
}

// ─── Word type alias ───
type OCRWord = { text: string; confidence: number; bbox: BBox };
type OCRLine = { text: string; confidence: number; bbox: BBox; words: OCRWord[] };

// ─── Common word dictionaries (for readability scoring) ───
const LATIN_SHORT_KEEP = new Set([
  'I', 'A', 'EH', 'ME', 'OH', 'AH', 'NO', 'GO',
  'IT', 'TO', 'DO', 'IN', 'ON', 'OF', 'IF', 'IS', 'BE', 'WE',
  'US', 'MY', 'OR', 'AN', 'AT', 'AS', 'AM', 'UP',
]);
const LATIN_COMMON = new Set([
  'THE', 'A', 'I', 'YOU', 'HE', 'SHE', 'WE', 'THEY', 'IT', 'TO', 'OF', 'IN',
  'ON', 'AT', 'FOR', 'AND', 'OR', 'IS', 'ARE', 'BE', 'THAT', 'THIS', 'THOSE',
  'THESE', 'PAST', 'ONLY', 'FOUND', 'TOP', 'GIRLS', 'CITY', 'BUT', 'NOW',
  'CAN', 'MAKE', 'WITH', 'KIND', 'STUFF', 'ROOM', 'DOOR', 'LOCK', 'TAKE',
  'LOOK', 'OVER', 'GO', 'STUDENTS', 'MAY', 'DOING', 'BAD', 'THINGS', 'ELDERLY',
  'WEAK', 'WOMEN', 'CHILDREN', 'TOWN', 'SIN', 'NOT', 'JUST', 'ALL', 'COME',
  'ACROSS', 'WHAT', 'THINK', 'BEST', 'ITS', 'ILL', 'WILL', 'WAS', 'BEEN',
  'HAVE', 'HAS', 'HAD', 'BEEN', 'WOULD', 'COULD', 'SHOULD', 'ABOUT', 'FROM',
  'INTO', 'OUT', 'GET', 'GOT', 'LIKE', 'KNOW', 'WANT', 'THINK', 'TELL', 'SAY',
  'SAID', 'HERE', 'THERE', 'WHERE', 'WHEN', 'HOW', 'WHY', 'WHO', 'WHICH',
  'BACK', 'JUST', 'THEN', 'THAN', 'VERY', 'ALSO', 'EVEN', 'MORE', 'SOME',
  'THEM', 'THEIR', 'PEOPLE', 'AFTER', 'BEFORE', 'STILL', 'MUCH', 'WELL',
  'GOOD', 'LONG', 'LIFE', 'WORLD', 'TIME', 'WORK', 'KEEP', 'NEED', 'FIND',
  'GIVE', 'MOST', 'ONLY', 'NEVER', 'EVER', 'EVERY', 'LITTLE', 'DOWN', 'AWAY',
  'OLD', 'NEW', 'FIRST', 'LAST', 'GREAT', 'HIGH', 'SMALL', 'PART', 'PLACE',
  'GOING', 'REALLY', 'SOMETHING', 'NOTHING', 'RIGHT', 'LEFT', 'HAND', 'EYES',
  'FACE', 'BODY', 'HEAD', 'HEART', 'MIND', 'GIRL', 'BOY', 'MAN', 'WOMAN',
  'LOVE', 'HATE', 'KILL', 'DEAD', 'DEATH', 'FIGHT', 'POWER', 'STRONG',
  'WEAK', 'YOUNG', 'SORRY', 'THANK', 'PLEASE', 'HELP', 'STOP', 'WAIT',
  'ENOUGH', 'SURE', 'OKAY', 'YEAH', 'YES', 'HUH', 'HEY', 'DAMN', 'HELL',
  'WHAT', 'DIDNT', 'DONT', 'WONT', 'CANT', 'WASNT', 'ISNT', 'ARENT',
  'FALL', 'THATS', 'LETS', 'HERES', 'WHATS', 'WHOS', 'HOWS', 'WHYS',
  'BECAUSE', 'SINCE', 'UNTIL', 'WHILE', 'THOUGH', 'ALREADY', 'AGAIN',
  'ONCE', 'ALWAYS', 'AROUND', 'THROUGH', 'BETWEEN', 'AGAINST', 'DURING',
  'WITHOUT', 'WITHIN', 'ABOVE', 'BELOW', 'UNDER', 'BESIDE', 'BEHIND',
  'BEHIND', 'WAY', 'OUR', 'YOUR', 'HIS', 'HER', 'MINE', 'YOURS', 'OURS',
  'WASTE', 'TALK', 'WALK', 'RUN', 'CALL', 'TURN', 'MOVE', 'OPEN', 'CLOSE',
  'HEAR', 'SEE', 'FEEL', 'LIVE', 'DIE', 'TRY', 'START', 'END', 'LEAVE',
  'LET', 'PUT', 'SET', 'SHOW', 'PLAY', 'PAY', 'READ', 'HOLD', 'STAND',
  'LOSE', 'MEAN', 'BRING', 'BEGIN', 'WATCH', 'SEEM', 'FOLLOW', 'LEARN',
  // Compound words (prevent false word-splitting)
  'BECOME', 'BEHAVE', 'FORGET', 'FORGIVE', 'FOREVER', 'OVERCOME',
  'SOMEHOW', 'SOMEWHERE', 'SOMETIME', 'EVERYWHERE', 'OVERLOOK',
  'OVERTAKE', 'OVERHEAR', 'OVERALL', 'OUTDO', 'OUTSIDE', 'INSIDE',
  'INCOME', 'OUTCOME', 'ANYONE', 'EVERYONE', 'SOMEONE', 'NOBODY',
  'ANYTHING', 'EVERYTHING', 'ANYMORE', 'ANYWAY', 'MAYBE', 'ALONE',
  'ALONG', 'HIMSELF', 'HERSELF', 'MYSELF', 'YOURSELF', 'ITSELF',
  'TODAY', 'TONIGHT', 'TOMORROW', 'YESTERDAY', 'TOGETHER',
  // Additional common words
  'DONE', 'GONE', 'CAME', 'WENT', 'TOOK', 'KNEW', 'TOLD', 'THING',
  'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'NAME', 'SAME', 'WRONG',
  'EACH', 'MUST', 'OWN', 'REAL', 'TRUE', 'FALSE', 'NEXT', 'COURSE',
  'ABLE', 'HAND', 'HOME', 'SIDE', 'FULL', 'CASE', 'ASK', 'POINT',
]);

// ─── Utility functions ───

function getAlpha(text: string): string {
  return (text || '').replace(/[^A-Za-z]/g, '');
}

function getAlphaNum(text: string): string {
  return (text || '').replace(/[^A-Za-z0-9]/g, '');
}

function isLexicalWord(text: string): boolean {
  // Strip trailing/leading punctuation for lookup (e.g., "DON'T" → "DONT", "LOOK!" → "LOOK")
  const cleaned = (text || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!cleaned) return false;
  if (LATIN_COMMON.has(cleaned)) return true;
  if (LATIN_SHORT_KEEP.has(cleaned)) return true;
  // Also try just the alpha chars
  const alpha = getAlpha(text).toUpperCase();
  if (alpha && LATIN_COMMON.has(alpha)) return true;
  if (alpha && LATIN_SHORT_KEEP.has(alpha)) return true;
  return false;
}

// ─── Garbage / noise filtering ───

/** Regex: mostly non-alphanumeric (symbols, pipes, brackets, dots, etc.) */
const GARBAGE_RE = /^[\s|=\-_.,;:!?'"(){}\[\]\\/<>@#$%^&*~`+0-9]+$/;
const VOWEL_RE = /[AEIOUaeiou]/;
const CONSONANT_RUN_RE = /[BCDFGHJKLMNPQRSTVWXYZ]{4,}/i;

/** Score how "readable" a Latin token is (0 = noise, 1 = perfect word) */
function scoreTokenReadability(word: OCRWord): number {
  const raw = (word.text || '').trim();
  const alpha = getAlpha(raw);
  if (!alpha) return 0;
  const upper = alpha.toUpperCase();
  if (LATIN_COMMON.has(upper) || LATIN_SHORT_KEEP.has(upper)) return 1.0;
  if (alpha.length === 1) return 0.25;
  const hasVowel = VOWEL_RE.test(alpha);
  const hasConsonantRun = CONSONANT_RUN_RE.test(alpha);
  const hasMixedCase = /[A-Z]/.test(raw) && /[a-z]/.test(raw) && alpha.length > 3;
  let score = 0.5;
  if (hasVowel) score += 0.2;
  if (!hasConsonantRun) score += 0.15;
  if (!hasMixedCase || alpha.length >= 6) score += 0.1;
  if (alpha.length >= 3 && alpha.length <= 12) score += 0.05;
  if (word.confidence >= 85) score += 0.1;
  if (word.confidence < 50) score -= 0.2;
  return Math.max(0, Math.min(1, score));
}

/** Count uppercase↔lowercase transitions in a string */
function countCaseTransitions(text: string): number {
  let t = 0;
  for (let i = 1; i < text.length; i++) {
    const pU = text[i - 1] >= 'A' && text[i - 1] <= 'Z';
    const pL = text[i - 1] >= 'a' && text[i - 1] <= 'z';
    const cU = text[i] >= 'A' && text[i] <= 'Z';
    const cL = text[i] >= 'a' && text[i] <= 'z';
    if ((pU && cL) || (pL && cU)) t++;
  }
  return t;
}

/** Words that are obviously OCR noise from manga artwork */
function isGarbageWord(text: string, confidence: number): boolean {
  if (confidence < 20) return true;
  if (text.length === 1 && confidence < 45) return true;
  if (GARBAGE_RE.test(text)) return true;
  // Very short non-dictionary with low confidence
  if (text.length <= 2 && confidence < 50) {
    const upper = getAlpha(text).toUpperCase();
    if (!LATIN_SHORT_KEEP.has(upper)) return true;
  }
  // Consonant-heavy garbage (e.g. "BHRKMEMANGAPYIO", "bDMSIMYAIAASY")
  const alpha = getAlpha(text);
  if (alpha.length >= 6) {
    const vowels = (alpha.match(VOWEL_RE) || []).length;
    const vowelRatio = vowels / alpha.length;
    if (vowelRatio < 0.15 && confidence < 85) return true;
  }
  // Mixed-case alternating gibberish (e.g., "CREAweaErSRETHIbe")
  if (alpha.length >= 6 && confidence < 90) {
    const transitions = countCaseTransitions(alpha);
    if (transitions >= 3) return true;
  }
  return false;
}

/** Detect watermark tokens (website names, logos near edges) */
function isWatermarkWord(word: OCRWord, pageWidth: number, pageHeight: number): boolean {
  const raw = (word.text || '').trim();
  const upper = raw.toUpperCase();
  const cx = (word.bbox.x0 + word.bbox.x1) / 2;
  const cy = (word.bbox.y0 + word.bbox.y1) / 2;
  const h = word.bbox.y1 - word.bbox.y0;
  const heightRatio = h / Math.max(1, pageHeight);
  const nearTop = cy < pageHeight * 0.08;
  const nearBottom = cy > pageHeight * 0.92;
  const nearEdge = nearTop || nearBottom;

  // Explicit watermark patterns (URLs, site names)
  if (/\.(io|com|net|org|co)\b/i.test(raw)) return true;
  if (/^(COM|NET|ORG|IO|WWW)$/i.test(raw) && nearEdge) return true;
  if (/^https?:?\/?/i.test(raw)) return true;
  if (/manga|comic|scans?|webtoon|toon|rawkuma|manhua/i.test(raw) && nearEdge) return true;
  if (/acloudmerge|likemanga/i.test(raw)) return true;

  // Very small text near edges is often watermark
  if (nearEdge && heightRatio < 0.018 && word.confidence < 90) return true;

  // Small text in corners
  const inCorner = nearEdge && (cx < pageWidth * 0.2 || cx > pageWidth * 0.8);
  if (inCorner && heightRatio < 0.025 && !isLexicalWord(raw)) return true;

  return false;
}

// ─── Word splitting (fix merged OCR words) ───

/** Try to split a merged word into two known words (e.g., "TAKEA"→["TAKE","A"]) */
function trySplitWord(text: string): [string, string] | null {
  if (!text || text.length < 4) return null;
  const alpha = getAlpha(text);
  if (alpha.length < 4) return null;
  const upper = alpha.toUpperCase();

  // Don't split words already in the dictionary
  if (LATIN_COMMON.has(upper) || LATIN_SHORT_KEEP.has(upper)) return null;

  // 1. Prefer splitting at case transitions (e.g., "NowI" → "Now" + "I")
  for (let i = 1; i < text.length; i++) {
    const pc = text[i - 1];
    const cc = text[i];
    if ((pc >= 'a' && pc <= 'z') && (cc >= 'A' && cc <= 'Z')) {
      const left = getAlpha(text.slice(0, i)).toUpperCase();
      const right = getAlpha(text.slice(i)).toUpperCase();
      if (
        left.length >= 1 &&
        right.length >= 1 &&
        (LATIN_COMMON.has(left) || LATIN_SHORT_KEEP.has(left)) &&
        (LATIN_COMMON.has(right) || LATIN_SHORT_KEEP.has(right))
      ) {
        return [text.slice(0, i), text.slice(i)];
      }
    }
  }

  // 2. Try all positions, prefer longest left part (e.g., "TAKEA" → "TAKE"+"A")
  for (let i = text.length - 1; i >= 2; i--) {
    const left = getAlpha(text.slice(0, i)).toUpperCase();
    const right = getAlpha(text.slice(i)).toUpperCase();
    if (right.length < 1) continue;
    if (right.length === 1 && !LATIN_SHORT_KEEP.has(right)) continue;
    if (left.length < 2) continue;
    if (
      (LATIN_COMMON.has(left) || LATIN_SHORT_KEEP.has(left)) &&
      (LATIN_COMMON.has(right) || LATIN_SHORT_KEEP.has(right))
    ) {
      return [text.slice(0, i), text.slice(i)];
    }
  }

  return null;
}

/** Split merged words into separate OCR words with approximate bboxes */
function splitMergedWords(words: OCRWord[]): OCRWord[] {
  const result: OCRWord[] = [];
  for (const w of words) {
    const split = trySplitWord(w.text);
    if (split) {
      const ratio = split[0].length / (split[0].length + split[1].length);
      const midX = w.bbox.x0 + (w.bbox.x1 - w.bbox.x0) * ratio;
      result.push({
        text: split[0],
        confidence: w.confidence,
        bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: Math.round(midX), y1: w.bbox.y1 },
      });
      result.push({
        text: split[1],
        confidence: w.confidence,
        bbox: { x0: Math.round(midX), y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
      });
    } else {
      result.push(w);
    }
  }
  return result;
}

/** Filter garbage and watermark words */
function filterNoiseWords(
  words: OCRWord[],
  pageWidth: number,
  pageHeight: number,
): OCRWord[] {
  return words.filter(w => {
    if (isGarbageWord(w.text, w.confidence)) return false;
    if (isWatermarkWord(w, pageWidth, pageHeight)) return false;
    return true;
  });
}

/** Build lines from words grouped by Y proximity */
function buildLines(words: OCRWord[], pageHeight: number): OCRLine[] {
  if (words.length === 0) return [];
  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const lineThreshold = pageHeight * 0.015;
  const result: OCRLine[] = [];
  let current: OCRWord[] = [];
  let lastY = -Infinity;

  for (const w of sorted) {
    if (w.bbox.y0 - lastY > lineThreshold && current.length > 0) {
      result.push(makeLineFromWords(current));
      current = [];
    }
    current.push(w);
    lastY = w.bbox.y0;
  }
  if (current.length > 0) result.push(makeLineFromWords(current));
  return result;
}

function makeLineFromWords(lineWords: OCRWord[]): OCRLine {
  const text = lineWords.map(w => w.text).join(' ');
  const bbox: BBox = {
    x0: Math.min(...lineWords.map(w => w.bbox.x0)),
    y0: Math.min(...lineWords.map(w => w.bbox.y0)),
    x1: Math.max(...lineWords.map(w => w.bbox.x1)),
    y1: Math.max(...lineWords.map(w => w.bbox.y1)),
  };
  const conf = lineWords.reduce((s, w) => s + w.confidence, 0) / lineWords.length;
  return { text, confidence: conf, bbox, words: lineWords };
}

/** Prune lines that are likely edge ghosts (noise near page borders) */
function pruneEdgeGhostLines(lines: OCRLine[], pageWidth: number, pageHeight: number): OCRLine[] {
  if (lines.length === 0) return lines;
  const edgeBand = Math.min(pageHeight * 0.16, Math.max(260, pageWidth * 0.35));
  const topBand = edgeBand;
  const bottomBand = pageHeight - edgeBand;

  return lines.filter(line => {
    const cy = (line.bbox.y0 + line.bbox.y1) / 2;
    const inEdge = cy <= topBand || cy >= bottomBand;
    if (!inEdge) return true; // Keep non-edge lines

    const lineWords = line.words;
    const alpha = getAlphaNum(line.text || '').toUpperCase();
    if (!alpha) return false; // Empty alpha in edge → drop

    const lexicalHits = lineWords.filter(w => isLexicalWord(w.text)).length;
    // Lines with multiple real words → keep
    if (lexicalHits >= 2 && alpha.length >= 4 && line.confidence >= 50) return true;

    const hasVowel = VOWEL_RE.test(alpha);
    const hasConsonantRun = CONSONANT_RUN_RE.test(alpha);

    // Strong single-word or multi-word readable line
    const readableScore = lineWords.reduce((s, w) => s + scoreTokenReadability(w), 0) / Math.max(1, lineWords.length);
    if (readableScore >= 0.7 && alpha.length >= 4 && line.confidence >= 60) return true;

    // Weak edge noise: short, low-conf, no vowels, or consonant runs
    if (alpha.length <= 3 && line.confidence < 70) return false;
    if (!hasVowel && alpha.length >= 3 && line.confidence < 85) return false;
    if (hasConsonantRun && line.confidence < 80) return false;
    if (lineWords.length === 1 && alpha.length <= 2 && !LATIN_SHORT_KEEP.has(alpha)) return false;

    // Lowercase single-char ghost (e.g., "a", "i")
    const raw0 = (lineWords[0]?.text || '').trim();
    if (lineWords.length === 1 && raw0.length === 1 && raw0 === raw0.toLowerCase() && raw0 !== raw0.toUpperCase()) {
      return false;
    }

    return true;
  });
}

/** Prune isolated garbage lines (high noise, spatially isolated) */
function pruneGarbageLines(lines: OCRLine[], pageWidth: number, pageHeight: number): OCRLine[] {
  if (lines.length === 0) return lines;

  return lines.filter(line => {
    const lineWords = line.words;
    if (lineWords.length === 0) return false;
    const alpha = getAlphaNum(line.text || '').toUpperCase();
    if (!alpha) return false;

    // Drop lowercase single-letter noise
    const raw0 = (lineWords[0]?.text || '').trim();
    if (lineWords.length === 1 && raw0.length === 1 && raw0 === raw0.toLowerCase() && raw0 !== raw0.toUpperCase()) {
      return false;
    }

    const lexicalHits = lineWords.filter(w => isLexicalWord(w.text)).length;
    const readableScore = lineWords.reduce((s, w) => s + scoreTokenReadability(w), 0) / Math.max(1, lineWords.length);
    const lexicalRatio = lexicalHits / Math.max(1, lineWords.length);

    // Lines with strong readable content → keep
    // Require either multiple lexical words OR a dominant lexical ratio
    if (lexicalHits >= 3) return true;
    if (lexicalHits >= 2 && lexicalRatio >= 0.4) return true;
    if (lexicalHits >= 1 && lexicalRatio >= 0.5 && readableScore >= 0.5) return true;
    if (readableScore >= 0.65 && alpha.length >= 4 && lexicalHits >= 1) return true;
    if (line.confidence >= 85 && alpha.length >= 3 && VOWEL_RE.test(alpha)) return true;

    // Lines with very low confidence and weak lexical presence → drop
    if (line.confidence < 40 && lexicalRatio < 0.5) return false;

    // Long consonant-heavy gibberish → drop
    if (alpha.length >= 6 && !VOWEL_RE.test(alpha)) return false;
    if (CONSONANT_RUN_RE.test(alpha) && line.confidence < 75) return false;

    // Mixed-case garbage (e.g., "bDMSIMYAIAASY")
    if (/[A-Z]/.test(alpha) && /[a-z]/.test(alpha) && alpha.length >= 5 && line.confidence < 70) return false;

    // Very low readability
    if (readableScore < 0.35 && line.confidence < 70) return false;

    // Short non-word fragments
    if (alpha.length <= 2 && !LATIN_SHORT_KEEP.has(alpha) && line.confidence < 75) return false;

    // ── Catch-all: zero lexical words → very likely noise ──
    if (lexicalHits === 0 && line.confidence < 90) return false;

    return true;
  });
}

/** Prune short fragment lines with no real words */
function pruneShortFragments(lines: OCRLine[]): OCRLine[] {
  return lines.filter(line => {
    const tokens = line.words
      .map(w => getAlphaNum(w.text).toUpperCase())
      .filter(t => t.length > 0);
    if (tokens.length === 0) return false;

    // Single character alone on a line → almost always OCR noise (except "I")
    if (tokens.length === 1 && tokens[0].length === 1 && tokens[0] !== 'I' && line.confidence < 85) return false;

    const lexTokens = tokens.filter(t => LATIN_COMMON.has(t) || LATIN_SHORT_KEEP.has(t));
    if (lexTokens.length > 0) return true;
    // Single-word line with short non-lexical token → drop (e.g. "COM", "AR", "ou")
    if (tokens.length === 1 && tokens[0].length <= 3 && line.confidence < 90) return false;
    const longTokens = tokens.filter(t => t.length >= 4);
    if (longTokens.length > 0) return true;
    if (line.confidence >= 90) return true;
    // All short non-word tokens → likely noise
    return false;
  });
}

/** Remove individual noise words from lines that have enough real-word context */
function cleanNoiseWordsWithinLines(lines: OCRLine[]): OCRLine[] {
  return lines.map(line => {
    if (line.words.length <= 1) return line;

    const lexCount = line.words.filter(w => isLexicalWord(w.text)).length;
    if (lexCount < 2) return line; // Not enough context

    // Determine whether the line is predominantly uppercase
    const upperWords = line.words.filter(w => {
      const a = getAlpha(w.text);
      return a.length >= 2 && a === a.toUpperCase();
    });
    const isUpperDominant = upperWords.length >= Math.ceil(line.words.length * 0.5);

    const cleaned = line.words.filter(w => {
      if (isLexicalWord(w.text)) return true;
      if (w.confidence >= 88) return true;

      const a = getAlpha(w.text);
      if (a.length === 0) return false;

      // Fully lowercase non-lexical word on an uppercase-dominant line → likely noise
      if (isUpperDominant && a.length >= 3 && a === a.toLowerCase()) return false;

      // Very short non-lexical on a line with real words
      if (a.length <= 2 && !LATIN_SHORT_KEEP.has(a.toUpperCase())) return false;

      return true;
    });

    if (cleaned.length === 0) return line; // Safety: don't empty
    if (cleaned.length === line.words.length) return line; // No change
    return makeLineFromWords(cleaned);
  });
}

/** Full filtering pipeline for stable worker */
function filterPipeline(
  words: OCRWord[],
  pageWidth: number,
  pageHeight: number,
): { words: OCRWord[]; lines: OCRLine[] } {
  // Step 0: Split merged words (TAKEA→TAKE+A, NowI→Now+I, MAKEDO→MAKE+DO)
  const split = splitMergedWords(words);

  // Step 1: Word-level noise removal
  let filtered = filterNoiseWords(split, pageWidth, pageHeight);

  // Step 2: Build lines from cleaned words
  let lines = buildLines(filtered, pageHeight);

  // Step 3: Line-level pruning
  lines = pruneEdgeGhostLines(lines, pageWidth, pageHeight);
  lines = pruneGarbageLines(lines, pageWidth, pageHeight);
  lines = pruneShortFragments(lines);

  // Step 3b: Remove noise words within surviving multi-word lines
  lines = cleanNoiseWordsWithinLines(lines);

  // Step 3c: Drop lines where surviving words have very little total substance
  lines = lines.filter(line => {
    const totalAlpha = line.words.reduce((s, w) => s + getAlpha(w.text).length, 0);
    const lexHits = line.words.filter(w => isLexicalWord(w.text)).length;
    const maxConf = Math.max(...line.words.map(w => w.confidence));
    // If line has few alpha chars and no/few lexical words AND not high-conf → noise
    if (totalAlpha <= 4 && lexHits < 2 && maxConf < 85) return false;
    // If line has only 1-2 surviving words with very short alpha → noise
    if (line.words.length <= 2 && totalAlpha <= 5 && lexHits < 1 && maxConf < 80) return false;
    return true;
  });

  // Rebuild words from surviving lines
  filtered = lines.flatMap(l => l.words);

  // Step 4: Page-level quality gate
  if (filtered.length > 0) {
    const totalReadable = filtered.reduce((s, w) => s + scoreTokenReadability(w), 0);
    const avgReadability = totalReadable / filtered.length;
    const lexCount = filtered.filter(w => isLexicalWord(w.text)).length;
    const totalAlpha = filtered.reduce((s, w) => s + getAlpha(w.text).length, 0);

    // If almost nothing is readable and no lexical words, clear
    if (avgReadability < 0.35 && lexCount < 2 && totalAlpha < 20) {
      return { words: [], lines: [] };
    }
  }

  return { words: filtered, lines };
}

// ─── Tesseract worker management ───

async function createWorkerWithLanguage(
  lang: string,
  sendUpdates = false,
): Promise<Awaited<ReturnType<typeof createWorker>>> {
  console.log(`[Worker-Stable] Creating Tesseract worker for: ${lang}`);
  const w = await createWorker(lang, OEM.LSTM_ONLY, {
    corePath: CONFIG.CORE_PATH,
    logger: m => {
      if (sendUpdates && m.status && typeof m.progress === 'number') {
        sendProgress(m.status, m.progress, m.workerId);
      }
    },
  });
  console.log(`[Worker-Stable] Tesseract ready for: ${lang}`);
  return w;
}

async function getOrCreateWorker(lang: string): Promise<Awaited<ReturnType<typeof createWorker>>> {
  while (isInitializing) await new Promise(r => setTimeout(r, 100));

  if (!tesseractWorker || currentLang !== lang) {
    isInitializing = true;
    try {
      if (tesseractWorker) {
        console.log(`[Worker-Stable] Switching language ${currentLang} → ${lang}`);
        await tesseractWorker.terminate();
      }
      tesseractWorker = await createWorkerWithLanguage(lang, false);
      currentLang = lang;
    } finally {
      isInitializing = false;
    }
  }
  return tesseractWorker;
}

// ─── TSV parser ───

function parseTSV(tsv: string): {
  words: Array<{ text: string; confidence: number; bbox: BBox }>;
  lines: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }>;
} {
  const words: Array<{ text: string; confidence: number; bbox: BBox }> = [];
  const lines: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }> = [];

  if (!tsv || typeof tsv !== 'string') return { words, lines };
  const rows = tsv.split('\n');
  if (rows.length < 2) return { words, lines };

  const header = rows[0].split('\t');
  const idx = {
    level: header.indexOf('level'),
    left: header.indexOf('left'),
    top: header.indexOf('top'),
    width: header.indexOf('width'),
    height: header.indexOf('height'),
    conf: header.indexOf('conf'),
    text: header.indexOf('text'),
  };
  if (Object.values(idx).some(i => i === -1)) return { words, lines };

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i].split('\t');
    if (cols.length <= idx.text) continue;

    const level = parseInt(cols[idx.level] || '0');
    const text = cols[idx.text]?.trim() || '';
    if (!text) continue;

    const left = parseInt(cols[idx.left] || '0');
    const top = parseInt(cols[idx.top] || '0');
    const w = parseInt(cols[idx.width] || '0');
    const h = parseInt(cols[idx.height] || '0');
    const conf = parseFloat(cols[idx.conf] || '0');
    const bbox: BBox = { x0: left, y0: top, x1: left + w, y1: top + h };

    if (level === 5) words.push({ text, confidence: conf, bbox });
    if (level === 4) lines.push({ text, confidence: conf, bbox, words: [] });
  }

  return { words, lines };
}

// ─── Region grouping (for SEGMENT) ───

function groupWordsIntoRegions(
  words: Array<{ text: string; confidence: number; bbox: BBox }>,
  pageWidth: number,
  pageHeight: number,
  documentType: DocumentType,
) {
  if (words.length === 0) return [];

  const GAP_X = pageWidth * 0.05;
  const GAP_Y = pageHeight * 0.02;

  const sorted = [...words].sort((a, b) => {
    const dy = a.bbox.y0 - b.bbox.y0;
    return Math.abs(dy) > GAP_Y ? dy : a.bbox.x0 - b.bbox.x0;
  });

  const groups: Array<{ words: typeof words; bbox: BBox }> = [];

  for (const word of sorted) {
    let added = false;
    for (const g of groups) {
      const xGap = word.bbox.x0 - g.bbox.x1;
      const yOverlap = Math.min(word.bbox.y1, g.bbox.y1) - Math.max(word.bbox.y0, g.bbox.y0);
      const yGap = Math.abs(word.bbox.y0 - g.bbox.y1);

      if ((yOverlap > 0 && xGap < GAP_X && xGap > -word.bbox.x1) ||
          (yGap < GAP_Y && yGap >= 0 && Math.min(word.bbox.x1, g.bbox.x1) - Math.max(word.bbox.x0, g.bbox.x0) > 0)) {
        g.words.push(word);
        g.bbox = {
          x0: Math.min(g.bbox.x0, word.bbox.x0),
          y0: Math.min(g.bbox.y0, word.bbox.y0),
          x1: Math.max(g.bbox.x1, word.bbox.x1),
          y1: Math.max(g.bbox.y1, word.bbox.y1),
        };
        added = true;
        break;
      }
    }
    if (!added) groups.push({ words: [word], bbox: { ...word.bbox } });
  }

  return groups
    .map((g, i) => {
      const text = g.words.map(w => w.text).join(' ');
      const avgConf = g.words.reduce((s, w) => s + w.confidence, 0) / g.words.length;
      return {
        id: `region-${i}-${Date.now()}`,
        type: 'text' as const,
        box: { x: g.bbox.x0, y: g.bbox.y0, w: g.bbox.x1 - g.bbox.x0, h: g.bbox.y1 - g.bbox.y0 },
        originalText: text,
        confidence: avgConf / 100,
      };
    })
    .filter(r => r.originalText.length > 0 && r.confidence >= CONFIG.MIN_CONFIDENCE / 100);
}

// ─── Message handler ───

self.onmessage = async (e: MessageEvent) => {
  const { type, payload, id } = e.data;

  try {
    switch (type) {
      // ─── INIT ───
      case 'INIT': {
        console.log('[Worker-Stable] Initializing...');
        await getOrCreateWorker('eng');
        self.postMessage({ type: 'INIT_SUCCESS', id });
        break;
      }

      // ─── OCR_FOR_TEXT_LAYER ───
      case 'OCR_FOR_TEXT_LAYER': {
        const {
          imageUrl,
          imageWidth,
          imageHeight,
          language = 'eng',
          dpi = 300,
        } = payload;

        console.log(
          `[Worker-Stable] OCR_FOR_TEXT_LAYER: ${imageWidth}x${imageHeight} @${dpi}DPI lang=${language}`,
        );

        // Skip heavy preprocessing — pass image directly to Tesseract.
        // Only fetch dimensions if the caller didn't supply valid ones.
        let actualWidth = Math.round(imageWidth);
        let actualHeight = Math.round(imageHeight);

        if (actualWidth < 10 || actualHeight < 10) {
          try {
            const dims = await getImageDimensions(imageUrl);
            actualWidth = dims.width;
            actualHeight = dims.height;
          } catch { /* use caller values */ }
        }

        sendProgress('Initializing OCR...', 0.1);
        const worker = await getOrCreateWorker(language);

        sendProgress('Configuring OCR...', 0.15);
        await worker.setParameters({
          tessedit_create_hocr: '1',
          tessedit_create_tsv: '1',
          tessedit_create_pdf: '0',
          hocr_font_info: '1',
        });

        sendProgress('Recognizing text...', 0.2);
        const result = (await worker.recognize(imageUrl)) as TesseractResult;

        sendProgress('Processing results...', 0.8);
        const data = result.data;

        const tsvParsed = parseTSV(data.tsv || '');
        let words = tsvParsed.words;
        let lines = tsvParsed.lines;

        // Fallback: no words from TSV but raw text exists
        if (words.length === 0 && data.text && data.text.trim().length > 0) {
          const rawLines = data.text.split('\n').filter(l => l.trim().length > 0);
          const lineH = actualHeight / (rawLines.length + 2);

          rawLines.forEach((lineText, idx) => {
            const y0 = (idx + 1) * lineH;
            const bbox: BBox = { x0: 20, y0, x1: actualWidth - 20, y1: y0 + lineH };
            const w = { text: lineText.trim(), confidence: data.confidence || 0, bbox };
            words.push(w);
            lines.push({ text: lineText.trim(), confidence: data.confidence || 0, bbox, words: [w] });
          });
        }

        // ── Full noise-filtering pipeline ──
        const rawCount = words.length;
        const pipeline = filterPipeline(words, actualWidth, actualHeight);
        words = pipeline.words;
        lines = pipeline.lines;

        console.log(
          `[Worker-Stable] OCR done: ${rawCount}→${words.length} words, ${lines.length} lines, conf=${data.confidence?.toFixed(1)}%`,
        );

        const pageResult = {
          pageNumber: 1,
          width: actualWidth,
          height: actualHeight,
          dpi,
          language,
          algorithmVersion: 46,
          pipelineProfile: (payload.pipelineProfile as string) || 'export',
          lines,
          words,
          text: data.text || '',
          confidence: data.confidence || 0,
        };

        sendProgress('Complete', 1.0);
        self.postMessage({ type: 'OCR_TEXT_LAYER_RESULT', id, payload: pageResult });
        break;
      }

      // ─── SEGMENT ───
      case 'SEGMENT': {
        const { imageUrl, language = 'eng', documentType = 'manga' } = payload as {
          imageUrl: string;
          language: string;
          documentType: DocumentType;
        };

        sendProgress('Preprocessing image...', 0);

        let processedUrl = imageUrl;
        let imageWidth = 1000;
        let imageHeight = 1000;

        try {
          const dims = await getImageDimensions(imageUrl);
          imageWidth = dims.width;
          imageHeight = dims.height;
        } catch { /* use defaults */ }

        sendProgress('Starting segmentation...', 0.1);
        const worker = await getOrCreateWorker(language);
        await worker.setParameters({ tessedit_create_tsv: '1' });

        sendProgress('Running OCR...', 0.3);
        const result = (await worker.recognize(imageUrl)) as TesseractResult;

        sendProgress('Analyzing regions...', 0.7);
        const { words } = parseTSV(result.data.tsv || '');
        const regions = groupWordsIntoRegions(words, imageWidth, imageHeight, documentType);

        if (regions.length === 0 && result.data.text && result.data.text.trim().length > 0) {
          self.postMessage({
            type: 'SEGMENT_RESULT',
            id,
            payload: [{
              id: `fallback-${Date.now()}`,
              type: 'text',
              box: { x: 0, y: 0, w: imageWidth, h: imageHeight },
              originalText: result.data.text.trim(),
              confidence: (result.data.confidence || 50) / 100,
            }],
          });
          break;
        }

        self.postMessage({ type: 'SEGMENT_RESULT', id, payload: regions });
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error('[Worker-Stable] Error:', error);
    self.postMessage({
      type: 'ERROR',
      id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export {};
