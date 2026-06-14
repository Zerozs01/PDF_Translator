import { TranslatableLine } from './translationBatchService';

export interface DehyphenatedJoin {
  /** The index of the parent (keeping) line */
  parentIdx: number;
  /** The index of the child (blanked) line */
  childIdx: number;
}

const DEHYPHEN_RE = {
  trailingHyphen: /[A-Za-z][\u002D\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u00AD]$/,
  leadingAlphaNum: /^[A-Za-z0-9]/,
} as const;

/**
 * Scans normalized line texts and returns a list of parent→child
 * pairs where de-hyphenation should occur.
 */
export function detectDehyphenatedJoins(
  normalizedTexts: string[]
): DehyphenatedJoin[] {
  const joins: DehyphenatedJoin[] = [];
  for (let i = 0; i < normalizedTexts.length - 1; i++) {
    const curr = normalizedTexts[i];
    const next = normalizedTexts[i + 1];
    if (
      curr &&
      next &&
      DEHYPHEN_RE.trailingHyphen.test(curr) &&
      DEHYPHEN_RE.leadingAlphaNum.test(next)
    ) {
      joins.push({ parentIdx: i, childIdx: i + 1 });
    }
  }
  return joins;
}

/**
 * Merges normalized texts using detected joins (running backwards to handle chains).
 */
export function mergeDehyphenatedSource(
  normalizedTexts: string[],
  joins: DehyphenatedJoin[]
): { merged: string[]; childSet: Set<number> } {
  const childSet = new Set(joins.map((j) => j.childIdx));
  const merged = [...normalizedTexts];
  for (let j = joins.length - 1; j >= 0; j--) {
    const { parentIdx, childIdx } = joins[j];
    if (merged[parentIdx] !== undefined && merged[childIdx] !== undefined) {
      const parentCleanText = merged[parentIdx].replace(/[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u00AD]$/, '');
      merged[parentIdx] = parentCleanText + merged[childIdx];
      merged[childIdx] = '';
    }
  }
  return { merged, childSet };
}

/**
 * Merges TranslatableLine arrays so that parent lines have updated text and dimensions,
 * and child lines are filtered out.
 */
export function getMergedTranslatableLines(
  lines: TranslatableLine[],
  joins: DehyphenatedJoin[]
): TranslatableLine[] {
  const childSet = new Set(joins.map((j) => j.childIdx));
  const merged = lines.map((l) => ({ ...l }));

  for (let j = joins.length - 1; j >= 0; j--) {
    const { parentIdx, childIdx } = joins[j];
    if (merged[parentIdx] && merged[childIdx]) {
      const parent = merged[parentIdx];
      const child = merged[childIdx];

      const parentCleanText = (parent.text || '').replace(/[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u00AD]$/, '');
      parent.text = parentCleanText + (child.text || '');
      parent.sourceLength = parent.text.length;

      // Expand bounding box
      parent.right = Math.max(parent.right, child.right);
      parent.left = Math.min(parent.left, child.left);
      parent.top = Math.min(parent.top, child.top);
      parent.bottom = Math.max(parent.bottom, child.bottom);
      parent.height = Math.max(1, parent.bottom - parent.top);
    }
  }

  return merged.filter((_, idx) => !childSet.has(idx));
}

/**
 * Maps slots (from redistributed translation) back to original line count,
 * inserting blank strings for child lines.
 */
export function mapSlotsToLines(
  slots: string[],
  lineCount: number,
  joins: DehyphenatedJoin[]
): string[] {
  const childSet = new Set(joins.map((j) => j.childIdx));
  const result: string[] = new Array(lineCount).fill('');

  let slotIdx = 0;
  for (let i = 0; i < lineCount; i++) {
    if (childSet.has(i)) {
      result[i] = '';
    } else {
      result[i] = slots[slotIdx] || '';
      slotIdx++;
    }
  }
  return result;
}
