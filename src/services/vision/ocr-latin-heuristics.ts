import type { OCRLine, OCRWord } from './ocr-types';
import { getAlphaNum } from './ocr-text-utils';

export function normalizeLatinTokenForLexicon(token: string): string {
	if (!token) return '';
	const upper = token.toUpperCase();
	if (/[A-Z]/.test(upper) && /[0-9]/.test(upper)) {
		return upper
			.replace(/0/g, 'O')
			.replace(/1/g, 'I')
			.replace(/5/g, 'S');
	}
	return upper;
}

export function countCaseTransitions(text: string): number {
	const letters = Array.from(text).filter((char) => /[A-Za-z]/.test(char));
	let transitions = 0;
	for (let i = 1; i < letters.length; i++) {
		const prev = letters[i - 1];
		const next = letters[i];
		const prevUpper = prev >= 'A' && prev <= 'Z';
		const prevLower = prev >= 'a' && prev <= 'z';
		const nextUpper = next >= 'A' && next <= 'Z';
		const nextLower = next >= 'a' && next <= 'z';
		if ((prevUpper && nextLower) || (prevLower && nextUpper)) transitions += 1;
	}
	return transitions;
}

function preserveReplacementCase(source: string, replacement: string): string {
	if (source === source.toUpperCase()) return replacement;
	if (source === source.toLowerCase()) return replacement.toLowerCase();
	return replacement.charAt(0) + replacement.slice(1).toLowerCase();
}

function boundedEditDistance(a: string, b: string, maxDistance: number): number | null {
	if (Math.abs(a.length - b.length) > maxDistance) return null;
	let previous = new Array<number>(b.length + 1);
	for (let j = 0; j <= b.length; j++) previous[j] = j;

	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		let rowMin = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
			if (current[j] < rowMin) rowMin = current[j];
		}
		if (rowMin > maxDistance) return null;
		previous = current;
	}

	return previous[b.length] <= maxDistance ? previous[b.length] : null;
}

function getApproxLexicalReplacement(
	token: string,
	latinCommonWords: Set<string>,
	latinShortKeepForLine: Set<string>
): string | null {
	if (!token || latinCommonWords.has(token) || latinShortKeepForLine.has(token)) return null;
	if (token.length < 4 || token.length > 12) return null;

	let best: string | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const candidate of latinCommonWords) {
		if (candidate.length < 4) continue;
		if (candidate[0] !== token[0]) continue;
		const distance = boundedEditDistance(token, candidate, token.length <= 5 ? 1 : 2);
		if (distance === null) continue;
		if (distance < bestDistance) {
			bestDistance = distance;
			best = candidate;
			if (distance === 1) break;
		}
	}
	return best;
}

function findMergedLatinSplit(
	text: string,
	latinCommonWords: Set<string>,
	latinShortKeepForLine: Set<string>
): string[] | null {
	const clean = getAlphaNum(text);
	if (!clean || clean.length < 4) return null;
	const upper = normalizeLatinTokenForLexicon(clean);
	const lexical = (token: string) => latinCommonWords.has(token) || latinShortKeepForLine.has(token);
	if (lexical(upper)) return null;

	for (let i = 1; i < text.length; i++) {
		const prev = text[i - 1];
		const next = text[i];
		if ((prev >= 'a' && prev <= 'z') && (next >= 'A' && next <= 'Z')) {
			const left = text.slice(0, i);
			const right = text.slice(i);
			const leftToken = normalizeLatinTokenForLexicon(getAlphaNum(left));
			const rightToken = normalizeLatinTokenForLexicon(getAlphaNum(right));
			if (lexical(leftToken) && lexical(rightToken)) {
				return [left, right];
			}
		}
	}

	for (let i = clean.length - 1; i >= 2; i--) {
		const leftToken = upper.slice(0, i);
		const rightToken = upper.slice(i);
		if (rightToken.length === 1 && !latinShortKeepForLine.has(rightToken)) continue;
		if (lexical(leftToken) && lexical(rightToken)) {
			return [clean.slice(0, i), clean.slice(i)];
		}
	}

	return null;
}

function trySplitMergedLatinWord(
	text: string,
	latinCommonWords: Set<string>,
	latinShortKeepForLine: Set<string>,
	depth: number = 0
): string[] | null {
	if (depth > 3) return null;
	const split = findMergedLatinSplit(text, latinCommonWords, latinShortKeepForLine);
	if (!split) return null;

	const output: string[] = [];
	for (const part of split) {
		const nested = trySplitMergedLatinWord(part, latinCommonWords, latinShortKeepForLine, depth + 1);
		if (nested && nested.length > 1) output.push(...nested);
		else output.push(part);
	}
	return output.length > 1 ? output : null;
}

export function splitMergedLatinWords(
	words: OCRWord[],
	latinCommonWords: Set<string>,
	latinShortKeepForLine: Set<string>
): number {
	if (words.length === 0) return 0;
	const nextWords: OCRWord[] = [];
	let fixed = 0;

	for (const word of words) {
		const parts = trySplitMergedLatinWord((word.text || '').trim(), latinCommonWords, latinShortKeepForLine);
		if (!parts || parts.length <= 1) {
			nextWords.push(word);
			continue;
		}

		const totalChars = Math.max(1, parts.reduce((sum, part) => sum + Math.max(1, getAlphaNum(part).length), 0));
		const totalWidth = Math.max(1, word.bbox.x1 - word.bbox.x0);
		let cursorX = word.bbox.x0;
		for (let index = 0; index < parts.length; index++) {
			const part = parts[index];
			const partChars = Math.max(1, getAlphaNum(part).length);
			const remainingWidth = Math.max(1, word.bbox.x1 - cursorX);
			const width = index === parts.length - 1
				? remainingWidth
				: Math.max(1, Math.round((partChars / totalChars) * totalWidth));
			const nextX = index === parts.length - 1 ? word.bbox.x1 : Math.min(word.bbox.x1, cursorX + width);
			nextWords.push({
				text: part,
				confidence: word.confidence,
				bbox: { x0: cursorX, y0: word.bbox.y0, x1: nextX, y1: word.bbox.y1 },
			});
			cursorX = nextX;
		}
		fixed += parts.length - 1;
	}

	if (fixed > 0) {
		words.splice(0, words.length, ...nextWords);
	}
	return fixed;
}

export function correctApproxLatinWords(
	words: OCRWord[],
	latinCommonWords: Set<string>,
	latinShortKeepForLine: Set<string>
): number {
	let fixed = 0;
	for (const word of words) {
		const raw = (word.text || '').trim();
		const alpha = getAlphaNum(raw);
		if (!alpha) continue;
		const normalized = normalizeLatinTokenForLexicon(alpha);
		const replacement = getApproxLexicalReplacement(normalized, latinCommonWords, latinShortKeepForLine);
		if (!replacement) continue;
		const nextText = raw.replace(/[A-Za-z0-9]+/, preserveReplacementCase(alpha, replacement));
		if (nextText !== raw) {
			word.text = nextText;
			fixed += 1;
		}
	}
	return fixed;
}

export function cleanNoiseWordsWithinLatinLines(
	lines: OCRLine[],
	latinCommonWords: Set<string>,
	latinShortKeepForLine: Set<string>,
	makeLineFromWords: (words: OCRWord[]) => OCRLine
): OCRLine[] {
	return lines.map((line) => {
		const lineWords = (line.words || []).slice();
		if (lineWords.length <= 1) return line;

		const lexicalCount = lineWords.filter((word) => {
			const token = normalizeLatinTokenForLexicon(getAlphaNum((word.text || '').trim()));
			return latinCommonWords.has(token) || latinShortKeepForLine.has(token);
		}).length;
		if (lexicalCount < 2) return line;

		const uppercaseWords = lineWords.filter((word) => {
			const alpha = getAlphaNum((word.text || '').trim());
			return alpha.length >= 2 && alpha === alpha.toUpperCase();
		}).length;
		const upperDominant = uppercaseWords >= Math.ceil(lineWords.length * 0.5);

		const cleaned = lineWords.filter((word) => {
			const raw = (word.text || '').trim();
			const alpha = getAlphaNum(raw);
			if (!alpha) return false;
			const normalized = normalizeLatinTokenForLexicon(alpha);
			if (latinCommonWords.has(normalized) || latinShortKeepForLine.has(normalized)) return true;
			if (word.confidence >= 88) return true;
			if (alpha.length <= 2 && !latinShortKeepForLine.has(normalized)) return false;
			if (countCaseTransitions(raw) >= 3) return false;
			if (upperDominant && alpha === alpha.toLowerCase() && !/[aeiou]/i.test(alpha)) return false;
			if (upperDominant && alpha === alpha.toLowerCase() && alpha.length >= 4 && word.confidence < 86) return false;
			return true;
		});

		return cleaned.length > 0 && cleaned.length !== lineWords.length ? makeLineFromWords(cleaned) : line;
	});
}

export function pruneResidualLatinNoiseLines(
	lines: OCRLine[],
	protectedWordKeys: Set<string> | undefined,
	latinCommonWords: Set<string>,
	latinShortKeepForLine: Set<string>,
	scoreLatinLineReadability: (lineWords: OCRWord[]) => number,
	hasProtectedWord: (line: { words: OCRWord[] }, protectedWordKeys?: Set<string>) => boolean
): OCRLine[] {
	return lines.filter((line) => {
		const lineWords = line.words || [];
		if (lineWords.length === 0) return false;
		if (hasProtectedWord(line, protectedWordKeys)) return true;

		const lineText = (line.text || '').trim();
		const alpha = normalizeLatinTokenForLexicon(getAlphaNum(lineText));
		if (!alpha) return false;

		const lexicalHits = lineWords.filter((word) => {
			const token = normalizeLatinTokenForLexicon(getAlphaNum((word.text || '').trim()));
			return latinCommonWords.has(token) || latinShortKeepForLine.has(token);
		}).length;
		const quality = scoreLatinLineReadability(lineWords);

		if (lineWords.length === 1 && alpha.length === 1 && !latinShortKeepForLine.has(alpha) && line.confidence < 96) {
			return false;
		}
		if (lexicalHits === 0 && countCaseTransitions(lineText) >= 3 && line.confidence < 96) {
			return false;
		}
		if (lexicalHits === 0 && quality < 0.58 && line.confidence < 94) {
			return false;
		}
		return true;
	});
}

