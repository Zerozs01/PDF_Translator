import type { BBox, OCRLine, OCRWord } from './ocr-types';
import { logDrop } from './ocr-config';
import { getAlphaNum } from './ocr-text-utils';

type TextLikeMetrics = {
	textLikeScore: number;
	edgeDarkRatio: number;
	interiorDarkRatio: number;
	centerBandDarkRatio: number;
	connectedComponentCount: number;
	horizontalPeakCount: number;
};

export interface LatinAnchorProbe {
	id: string;
	anchorLineIndex: number;
	bbox: BBox;
	probeType: 'anchorSecondLine' | 'anchorTopSparse' | 'anchorBottomSparse';
	minConf: number;
	psmOrder: number[];
}

export interface AnalyzeTextLikeProbeDeps {
	analyzeRegionTextLikeness: (
		gray: Uint8ClampedArray,
		pageWidth: number,
		pageHeight: number,
		bbox: BBox
	) => TextLikeMetrics;
	isLikelyTextRegion: (metrics: TextLikeMetrics) => boolean;
	borderArtifactEdgeBandRatio: number;
	borderArtifactCenterDarkRatioMin: number;
	borderArtifactComponentMin: number;
	borderArtifactHorizontalPeaksMin: number;
}

export interface BuildLatinAnchorProbesDeps {
	scoreLatinLineReadability: (lineWords: OCRWord[]) => number;
	getMedianHeight: (words: OCRWord[]) => number;
	clampBBox: (bbox: BBox, pageWidth: number, pageHeight: number) => BBox;
	normalizeLatinLineText: (text: string) => string;
	latinCommonWords: Set<string>;
	latinShortKeepForLine: Set<string>;
	latinAnchorProbeTopCenterYRatioMax: number;
	latinAnchorProbeMinLineQuality: number;
	latinAnchorProbeXPadMult: number;
	latinAnchorProbeYPadAbove: number;
	latinAnchorProbeYPadBelow: number;
	latinLineRescanConf: number;
	latinTopProbeMinConf: number;
	latinBottomProbeEnable: boolean;
	latinBottomProbeXPadMult: number;
	latinBottomProbeYPadAbove: number;
	latinBottomProbeYPadBelow: number;
	latinBottomProbeMinFreeBandMult: number;
	latinBottomProbeMaxFreeBandMult: number;
	latinBottomProbeMinConf: number;
	psmSingleBlock: number;
	psmSparseText: number;
}

export interface IsLikelyLatinSpeechPageDeps {
	maxLines: number;
	maxWords: number;
	topCenterYRatio: number;
	minReadableHitsPerLine: number;
	minNormalizedLineLength: number;
	minReadableTokenScore: number;
}

export interface ScoreLatinCandidateDeps {
	latinCommonWords: Set<string>;
	latinShortKeepForLine: Set<string>;
}

export interface AssessLatinLineDeps {
	latinCommonWords: Set<string>;
	latinShortKeepForLine: Set<string>;
}

export interface LatinLineAssessment {
	alpha: string;
	tokens: string[];
	confidence: number;
	quality: number;
	chars: number;
	commonHits: number;
	shortKeepHits: number;
	lexicalHits: number;
	meaningfulWords: number;
	readableRatio: number;
	nonLexicalCount: number;
	noisySingles: number;
	avgTokenLen: number;
	shortTokenCount: number;
	mixedCaseWordCount: number;
	titleCaseWordCount: number;
	hasVowel: boolean;
	hasDigit: boolean;
	recoveryScore: number;
	coreKeep: boolean;
	recoveryAccept: boolean;
	ghostLikely: boolean;
	reason: string;
}

export function normalizeLatinTokenForLexicon(token: string): string {
	if (!token) return '';
	const upper = token.toUpperCase();
	if (/^[0-9]{1,2}$/.test(upper)) {
		// Common stylized OCR confusions in short tokens (e.g. "60" -> "GO").
		return upper
			.replace(/0/g, 'O')
			.replace(/1/g, 'I')
			.replace(/5/g, 'S')
			.replace(/6/g, 'G')
			.replace(/7/g, 'T')
			.replace(/8/g, 'B');
	}
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

export function normalizeShortDigitLatinWords(
	words: OCRWord[],
	latinCommonWords: Set<string>,
	latinShortKeepForLine: Set<string>
): number {
	let fixed = 0;
	for (const word of words) {
		const raw = (word.text || '').trim();
		if (!raw) continue;
		const alpha = getAlphaNum(raw);
		if (!alpha) continue;
		if (!/^[0-9]{1,2}$/.test(alpha)) continue;

		const normalized = normalizeLatinTokenForLexicon(alpha);
		if (!(latinCommonWords.has(normalized) || latinShortKeepForLine.has(normalized))) continue;

		const replaced = raw.replace(/[0-9]{1,2}/, normalized);
		if (replaced !== raw) {
			word.text = replaced;
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
	const strongLineCenters = lines
		.map((line) => {
			const lineWords = line.words || [];
			if (lineWords.length < 2) return null;
			const assessment = assessLatinLine(lineWords, line.text || '', line.confidence, {
				latinCommonWords,
				latinShortKeepForLine,
			});
			if (assessment.alpha.length < 5) return null;
			if (!assessment.coreKeep && !(assessment.lexicalHits >= 1 && assessment.quality >= 0.44 && line.confidence >= 64)) return null;
			const centerY = (line.bbox.y0 + line.bbox.y1) / 2;
			return Number.isFinite(centerY) ? centerY : null;
		})
		.filter((centerY): centerY is number => typeof centerY === 'number');

	return lines.filter((line) => {
		const lineWords = line.words || [];
		if (lineWords.length === 0) return false;
		const protectedLine = hasProtectedWord(line, protectedWordKeys);
		const assessment = assessLatinLine(lineWords, line.text || '', line.confidence, {
			latinCommonWords,
			latinShortKeepForLine,
		});

		const lineText = (line.text || '').trim();
		const alpha = assessment.alpha;
		if (!alpha) return false;

		const lexicalHits = assessment.lexicalHits;
		const lineTokens = assessment.tokens;
		const quality = assessment.quality;

		if (assessment.coreKeep) return true;
		if (!protectedLine && assessment.ghostLikely) {
			const probeWord = lineWords[0];
			if (probeWord) logDrop('latinLine', probeWord, `residual ${assessment.reason}`);
			return false;
		}

		if (lineWords.length === 1) {
			const lexicalSingleton = latinCommonWords.has(alpha) || latinShortKeepForLine.has(alpha);
			if (alpha.length === 1) {
				// In manga OCR these are almost always residual artifacts.
				return false;
			}
			if (alpha.length <= 2 && lexicalSingleton) {
				if (!protectedLine || line.confidence < 99) return false;
			}
			if (alpha.length <= 3 && !lexicalSingleton && line.confidence < 98 && quality < 0.86) {
				return false;
			}
		}

		if (lexicalHits === 0 && lineTokens.length > 0 && lineTokens.length <= 2) {
			const avgTokenLen = lineTokens.reduce((sum, token) => sum + token.length, 0) / lineTokens.length;
			if (avgTokenLen <= 2.2 && line.confidence < 98 && quality < 0.82) {
				return false;
			}
		}
		if (lexicalHits === 0 && lineTokens.length >= 4) {
			const avgTokenLen = lineTokens.reduce((sum, token) => sum + token.length, 0) / lineTokens.length;
			const tinyTokenCount = lineTokens.filter((token) => token.length <= 2).length;
			const mixedCaseWordCount = lineWords.filter((word) => {
				const raw = (word.text || '').trim();
				return /[A-Z]/.test(raw) && /[a-z]/.test(raw);
			}).length;
			const fragmentedLike = avgTokenLen <= 3.8 && tinyTokenCount >= 1;
			if (
				fragmentedLike
				&& (mixedCaseWordCount >= 1 || countCaseTransitions(lineText) >= 2)
				&& quality < 0.86
				&& line.confidence < 99
			) {
				return false;
			}
		}
		if (lineTokens.length >= 5) {
			const avgTokenLen = lineTokens.reduce((sum, token) => sum + token.length, 0) / lineTokens.length;
			const tinyTokenCount = lineTokens.filter((token) => token.length <= 2).length;
			const mixedCaseWordCount = lineWords.filter((word) => {
				const raw = (word.text || '').trim();
				return /[A-Z]/.test(raw) && /[a-z]/.test(raw);
			}).length;
			const lowLexicalDensity = lexicalHits <= 1;
			if (
				lowLexicalDensity
				&& avgTokenLen <= 4.2
				&& tinyTokenCount >= 2
				&& mixedCaseWordCount >= 1
				&& quality < 0.9
				&& line.confidence < 96
			) {
				return false;
			}
		}
		if (lineTokens.length >= 3) {
			const shortKeepOnly = lineTokens.every((token) => latinShortKeepForLine.has(token) && token.length <= 2);
			if (shortKeepOnly) {
				const unique = new Set(lineTokens);
				const repeatedShortNoise = unique.size <= 2;
				if (repeatedShortNoise && line.confidence < 99) {
					return false;
				}
			}
		}
		if (lineTokens.length === 2) {
			const oneCharShortKeepOnly = lineTokens.every((token) => token.length === 1 && latinShortKeepForLine.has(token));
			if (oneCharShortKeepOnly && !protectedLine && line.confidence < 99) {
				return false;
			}
		}
		if (lexicalHits === 0 && countCaseTransitions(lineText) >= 3 && line.confidence < 96) {
			return false;
		}
		if (lexicalHits === 0 && quality < 0.58 && line.confidence < 94) {
			return false;
		}

		// Remove short isolated fragments (e.g. "I", "A", "In", "Nor") that are far from
		// any strong lexical line cluster and are likely image-induced ghosts.
		if (strongLineCenters.length >= 2 && lineWords.length <= 2 && alpha.length <= 3) {
			const centerY = (line.bbox.y0 + line.bbox.y1) / 2;
			const lineH = Math.max(1, line.bbox.y1 - line.bbox.y0);
			let minDelta = Number.POSITIVE_INFINITY;
			for (const strongCenter of strongLineCenters) {
				const delta = Math.abs(centerY - strongCenter);
				if (delta < minDelta) minDelta = delta;
			}

			const lexicalSingleton = latinCommonWords.has(alpha) || latinShortKeepForLine.has(alpha);
			const farFromStrongCluster = Number.isFinite(minDelta) && minDelta > lineH * 3.4;
			if (farFromStrongCluster) {
				if (!lexicalSingleton) return false;
				if (lineWords.length === 1 && (!protectedLine || line.confidence < 99)) return false;
				if (quality < 0.92 && line.confidence < 99) return false;
			}
		}

		return true;
	});
}

export function trimTrailingShortKeepArtifacts(
	lines: OCRLine[],
	latinCommonWords: Set<string>,
	latinShortKeepForLine: Set<string>,
	makeLineFromWords: (words: OCRWord[]) => OCRLine
): OCRLine[] {
	return lines.map((line) => {
		const lineWords = (line.words || []).slice();
		if (lineWords.length < 4) return line;

		const tokens = lineWords.map((word) => normalizeLatinTokenForLexicon(getAlphaNum((word.text || '').trim())));
		let trailingShortKeep = 0;
		for (let i = tokens.length - 1; i >= 0; i--) {
			const token = tokens[i];
			if (!token) break;
			if (!(latinShortKeepForLine.has(token) && token.length <= 2)) break;
			trailingShortKeep += 1;
		}

		if (trailingShortKeep < 2) return line;
		const keepCount = lineWords.length - trailingShortKeep;
		if (keepCount < 2) return line;

		const headTokens = tokens.slice(0, keepCount).filter(Boolean);
		const headLexicalHits = headTokens.filter((token) => latinCommonWords.has(token)).length;
		const avgTailConf = lineWords.slice(keepCount).reduce((sum, word) => sum + word.confidence, 0) / trailingShortKeep;
		if (headLexicalHits >= 1 && avgTailConf < 90) {
			return makeLineFromWords(lineWords.slice(0, keepCount));
		}
		return line;
	});
}

export function trimTrailingNonLexicalArtifacts(
	lines: OCRLine[],
	latinCommonWords: Set<string>,
	latinShortKeepForLine: Set<string>,
	makeLineFromWords: (words: OCRWord[]) => OCRLine
): OCRLine[] {
	return lines.map((line) => {
		const lineWords = (line.words || []).slice();
		if (lineWords.length < 3) return line;

		const tokens = lineWords.map((word) => normalizeLatinTokenForLexicon(getAlphaNum((word.text || '').trim())));
		const lineQuality = scoreLatinLineReadability(lineWords);
		const uppercaseWords = lineWords.filter((word) => {
			const alpha = getAlphaNum((word.text || '').trim());
			return alpha.length >= 2 && alpha === alpha.toUpperCase();
		}).length;
		const upperDominant = uppercaseWords >= Math.ceil(lineWords.length * 0.5);
		let keepCount = lineWords.length;

		while (keepCount > 2) {
			const idx = keepCount - 1;
			const word = lineWords[idx];
			const token = tokens[idx] || '';
			if (!token) break;
			if (latinCommonWords.has(token) || latinShortKeepForLine.has(token)) break;

			const raw = (word.text || '').trim();
			const lowerCaseTail = /^[a-z][a-z'’-]*$/.test(raw);
			const shortTail = token.length <= 3;
			const weakTail = word.confidence < 72;
			const readableTail = scoreLatinTokenReadability(word);
			const lowReadableTail = readableTail < 0.58 || (token.length <= 4 && !/[AEIOU]/.test(token));
			const strongReadableTail = token.length >= 4 && readableTail >= 0.78 && word.confidence >= 88;
			if (strongReadableTail) break;

			const suspiciousLowerCaseTail = lowerCaseTail
				&& (upperDominant || lineQuality < 0.76)
				&& (weakTail || lowReadableTail);
			const suspiciousShortTail = shortTail && (weakTail || readableTail < 0.52);
			const suspiciousConsonantTail = token.length <= 5 && !/[AEIOU]/.test(token) && (weakTail || readableTail < 0.5);
			if (!(suspiciousLowerCaseTail || suspiciousShortTail || suspiciousConsonantTail)) break;

			logDrop('latinLine', word, 'trim trailing non-lexical artifact');

			keepCount -= 1;
		}

		if (keepCount === lineWords.length) return line;
		if (keepCount < 2) return line;

		const keptTokens = tokens.slice(0, keepCount).filter(Boolean);
		const keptLexical = keptTokens.filter((token) => latinCommonWords.has(token) || latinShortKeepForLine.has(token)).length;
		const keptRatio = keptLexical / Math.max(1, keptTokens.length);
		if (keptLexical >= 1 && keptRatio >= 0.45) {
			return makeLineFromWords(lineWords.slice(0, keepCount));
		}

		return line;
	});
}

export function getLatinLexicalHits(
	lineWords: OCRWord[],
	latinCommonWords: Set<string>,
	latinShortKeepForLine: Set<string>
): number {
	return lineWords
		.map((w) => normalizeLatinTokenForLexicon(getAlphaNum((w.text || '').trim())))
		.filter((token) => latinCommonWords.has(token) || latinShortKeepForLine.has(token))
		.length;
}

export function scoreLatinTokenReadability(word: OCRWord): number {
	const raw = (word.text || '').trim();
	if (!raw) return 0;
	const rawAlpha = getAlphaNum(raw);
	if (!rawAlpha) return 0;
	const alpha = normalizeLatinTokenForLexicon(rawAlpha);

	const confScore = Math.max(0, Math.min(1, word.confidence / 100));
	const letters = (alpha.match(/[A-Za-z]/g) || []).length;
	const digits = (rawAlpha.match(/[0-9]/g) || []).length;

	if (letters === 0) {
		if (/^[0-9]{1,2}$/.test(alpha)) return confScore * 0.18;
		return confScore * 0.08;
	}

	const vowels = (alpha.match(/[AEIOUaeiou]/g) || []).length;
	const consonants = letters - vowels;

	let score = confScore;
	if (alpha.length === 1 && !/^[IAia]$/.test(alpha)) score *= 0.35;
	if (letters >= 3 && vowels === 0 && consonants >= 3 && word.confidence < 92) score *= 0.38;
	if (digits > 0 && letters > 0 && word.confidence < 92) score *= 0.55;
	if (/^[A-Z]{2}$/.test(alpha) && word.confidence >= 60) score = Math.max(score, 0.62);
	if (/^[A-Z]{3,}$/.test(alpha) && vowels === 0 && word.confidence < 88) score *= 0.72;
	return Math.max(0, Math.min(1, score));
}

export function scoreLatinLineReadability(lineWords: OCRWord[]): number {
	if (lineWords.length === 0) return 0;
	const score = lineWords.reduce((sum, word) => sum + scoreLatinTokenReadability(word), 0) / lineWords.length;
	return Math.max(0, Math.min(1, score));
}

export function countMeaningfulLatinWords(
	words: OCRWord[],
	latinCommonWords: Set<string>,
	latinShortKeepForLine: Set<string>
): number {
	let count = 0;
	for (const word of words) {
		const alpha = getAlphaNum((word.text || '').trim());
		if (!alpha) continue;
		const normalized = normalizeLatinTokenForLexicon(alpha);
		if (!normalized) continue;
		if (latinCommonWords.has(normalized) || latinShortKeepForLine.has(normalized)) {
			count += 1;
			continue;
		}
		const hasVowel = /[AEIOU]/.test(normalized);
		const longConsonantRun = /[BCDFGHJKLMNPQRSTVWXYZ]{5,}/.test(normalized);
		if (normalized.length >= 3 && hasVowel && !longConsonantRun && word.confidence >= 62) {
			count += 1;
		}
	}
	return count;
}

export function scoreLatinCandidate(
	words: OCRWord[],
	lines: OCRLine[],
	deps: ScoreLatinCandidateDeps
): number {
	if (words.length === 0) return 0;
	const meaningful = countMeaningfulLatinWords(words, deps.latinCommonWords, deps.latinShortKeepForLine);
	const lexicalHits = words.reduce((sum, word) => {
		const alpha = getAlphaNum((word.text || '').trim());
		if (!alpha) return sum;
		const normalized = normalizeLatinTokenForLexicon(alpha);
		return sum + (deps.latinCommonWords.has(normalized) ? 1 : 0);
	}, 0);
	const noisySingles = words.reduce((sum, word) => {
		const alpha = getAlphaNum((word.text || '').trim());
		if (!alpha) return sum;
		const normalized = normalizeLatinTokenForLexicon(alpha);
		return sum + (normalized.length === 1 && !deps.latinShortKeepForLine.has(normalized) ? 1 : 0);
	}, 0);
	const avgConfidence = words.reduce((sum, word) => sum + word.confidence, 0) / Math.max(1, words.length);
	const avgLineQuality = lines.length > 0
		? lines.reduce((sum, line) => sum + scoreLatinLineReadability((line.words as OCRWord[]) || []), 0) / lines.length
		: 0;
	return (meaningful * 2.6) + (lexicalHits * 1.6) + (avgConfidence * 0.06) + (avgLineQuality * 4.2) - (noisySingles * 1.2);
}

export function assessLatinLine(
	lineWords: OCRWord[],
	lineText: string,
	lineConfidence: number,
	deps: AssessLatinLineDeps
): LatinLineAssessment {
	const tokens = lineWords
		.map((word) => normalizeLatinTokenForLexicon(getAlphaNum((word.text || '').trim())))
		.filter(Boolean);
	const fallbackText = lineWords.map((word) => (word.text || '').trim()).filter(Boolean).join(' ');
	const alpha = normalizeLatinTokenForLexicon(getAlphaNum(lineText || fallbackText));
	const confidence = Number.isFinite(lineConfidence) && lineConfidence > 0
		? lineConfidence
		: (lineWords.reduce((sum, word) => sum + word.confidence, 0) / Math.max(1, lineWords.length));
	const quality = scoreLatinLineReadability(lineWords);
	const chars = alpha.length;
	const commonHits = tokens.filter((token) => deps.latinCommonWords.has(token)).length;
	const shortKeepHits = tokens.filter((token) => deps.latinShortKeepForLine.has(token)).length;
	const lexicalHits = commonHits + shortKeepHits;
	const meaningfulWords = countMeaningfulLatinWords(lineWords, deps.latinCommonWords, deps.latinShortKeepForLine);
	const readableTokens = tokens.filter((token) => {
		if (deps.latinCommonWords.has(token) || deps.latinShortKeepForLine.has(token)) return true;
		if (token.length < 3) return false;
		return /[AEIOU]/.test(token);
	}).length;
	const readableRatio = tokens.length > 0 ? readableTokens / tokens.length : 0;
	const nonLexicalCount = Math.max(0, tokens.length - lexicalHits);
	const noisySingles = tokens.filter((token) => token.length === 1 && !deps.latinShortKeepForLine.has(token)).length;
	const avgTokenLen = tokens.length > 0
		? tokens.reduce((sum, token) => sum + token.length, 0) / tokens.length
		: 0;
	const shortTokenCount = tokens.filter((token) => token.length <= 2).length;
	const mixedCaseWordCount = lineWords.filter((word) => {
		const raw = (word.text || '').trim();
		return /[A-Z]/.test(raw) && /[a-z]/.test(raw);
	}).length;
	const titleCaseWordCount = lineWords.filter((word) => /^[A-Z][a-z]{1,}$/.test((word.text || '').trim())).length;
	const hasVowel = /[AEIOU]/.test(alpha);
	const hasDigit = /[0-9]/.test(alpha);

	let ghostLikely = false;
	let reason = 'insufficientSignal';
	const titleCaseShortFragments = (
		tokens.length <= 3
		&& commonHits === 0
		&& shortKeepHits <= 1
		&& titleCaseWordCount >= Math.max(1, tokens.length - 1)
		&& avgTokenLen <= 3.35
		&& chars <= 10
	);
	const shortNonLexicalPhrase = (
		tokens.length <= 3
		&& commonHits === 0
		&& shortKeepHits <= 1
		&& nonLexicalCount >= Math.max(2, tokens.length - 1)
		&& avgTokenLen <= 3.2
		&& meaningfulWords <= 2
	);
	const lowSignalShortLine = (
		tokens.length <= 2
		&& lexicalHits === 0
		&& meaningfulWords <= 1
		&& chars <= 6
		&& quality < 0.88
		&& confidence < 98
	);
	const consonantGhost = !hasVowel && chars >= 4 && quality < 0.84 && confidence < 96;
	const repeatedShortKeepNoise = (
		tokens.length >= 3
		&& tokens.every((token) => deps.latinShortKeepForLine.has(token) && token.length <= 2)
		&& new Set(tokens).size <= 2
		&& confidence < 99
	);

	if (titleCaseShortFragments) {
		ghostLikely = true;
		reason = 'titleCaseShortFragments';
	} else if (shortNonLexicalPhrase) {
		ghostLikely = true;
		reason = 'shortNonLexicalPhrase';
	} else if (lowSignalShortLine) {
		ghostLikely = true;
		reason = 'lowSignalShortLine';
	} else if (consonantGhost) {
		ghostLikely = true;
		reason = 'consonantGhost';
	} else if (repeatedShortKeepNoise) {
		ghostLikely = true;
		reason = 'repeatedShortKeepNoise';
	}

	let coreKeep = false;
	if (commonHits >= 2 && chars >= 4 && quality >= 0.28) {
		coreKeep = true;
		reason = 'multiCommonLexical';
	} else if (lexicalHits >= 2 && readableRatio >= 0.72 && quality >= 0.44 && chars >= 6) {
		coreKeep = true;
		reason = 'multiLexicalReadable';
	} else if (!ghostLikely && meaningfulWords >= 3 && readableRatio >= 0.84 && chars >= 10 && quality >= 0.44 && confidence >= 50) {
		coreKeep = true;
		reason = 'readableSentence';
	} else if (!ghostLikely && tokens.length >= 2 && meaningfulWords >= 2 && readableRatio >= 0.92 && avgTokenLen >= 4 && chars >= 9 && quality >= 0.5 && confidence >= 68) {
		coreKeep = true;
		reason = 'readablePair';
	} else if (!ghostLikely && tokens.length === 1 && chars >= 7 && hasVowel && quality >= 0.54 && confidence >= 68) {
		coreKeep = true;
		reason = 'strongSingleton';
	}

	let recoveryAccept = coreKeep;
	if (
		!recoveryAccept
		&& !ghostLikely
		&& commonHits >= 1
		&& chars >= 4
		&& quality >= 0.38
		&& confidence >= 48
		&& nonLexicalCount <= Math.max(1, Math.floor(tokens.length * 0.5))
	) {
		recoveryAccept = true;
		reason = 'recoveryLexical';
	}
	if (
		!recoveryAccept
		&& !ghostLikely
		&& shortKeepHits >= 2
		&& nonLexicalCount === 0
		&& tokens.length <= 3
		&& chars <= 8
		&& quality >= 0.4
		&& confidence >= 42
	) {
		recoveryAccept = true;
		reason = 'shortKeepPhrase';
	}
	if (
		!recoveryAccept
		&& !ghostLikely
		&& meaningfulWords >= 3
		&& readableRatio >= 0.76
		&& chars >= 10
		&& avgTokenLen >= 3.2
		&& quality >= 0.4
		&& confidence >= 50
	) {
		recoveryAccept = true;
		reason = 'recoveryReadableSentence';
	}

	const recoveryScoreBase = (commonHits * 2.6)
		+ (meaningfulWords * 2.1)
		+ (quality * 5.1)
		+ (readableRatio * 3.2)
		+ (confidence * 0.045)
		+ (hasVowel ? 0.75 : 0)
		- (noisySingles * 1.25)
		- (mixedCaseWordCount >= 2 && commonHits === 0 ? 0.9 : 0)
		- (shortTokenCount >= 2 && commonHits === 0 ? 0.75 : 0);
	const recoveryScore = recoveryScoreBase + (coreKeep ? 2.4 : 0) + (recoveryAccept ? 1.2 : 0) - (ghostLikely ? 3.2 : 0);

	return {
		alpha,
		tokens,
		confidence,
		quality,
		chars,
		commonHits,
		shortKeepHits,
		lexicalHits,
		meaningfulWords,
		readableRatio,
		nonLexicalCount,
		noisySingles,
		avgTokenLen,
		shortTokenCount,
		mixedCaseWordCount,
		titleCaseWordCount,
		hasVowel,
		hasDigit,
		recoveryScore,
		coreKeep,
		recoveryAccept,
		ghostLikely,
		reason,
	};
}

export function isLikelyLatinSpeechPage(
	lines: OCRLine[],
	words: OCRWord[],
	pageHeight: number,
	deps: IsLikelyLatinSpeechPageDeps
): boolean {
	if (lines.length === 0 || words.length === 0) return false;
	if (lines.length > deps.maxLines) return false;
	if (words.length > deps.maxWords) return false;

	return lines.some((line) => {
		const lineWords = (line.words as OCRWord[]) || [];
		const centerY = (line.bbox.y0 + line.bbox.y1) / 2;
		if (centerY > pageHeight * deps.topCenterYRatio) return false;
		const readableHits = lineWords.reduce((sum, word) => {
			return sum + (scoreLatinTokenReadability(word) >= deps.minReadableTokenScore ? 1 : 0);
		}, 0);
		const normalizedLength = normalizeLatinTokenForLexicon(getAlphaNum(line.text || '')).length;
		return readableHits >= deps.minReadableHitsPerLine || normalizedLength >= deps.minNormalizedLineLength;
	});
}

export function analyzeTextLikeProbe(
	gray: Uint8ClampedArray | undefined,
	pageWidth: number,
	pageHeight: number,
	bbox: BBox,
	deps: AnalyzeTextLikeProbeDeps
): { allowed: boolean; score: number; reason: string } {
	if (!gray || gray.length < pageWidth * pageHeight) {
		return { allowed: true, score: 1, reason: 'gray-unavailable' };
	}

	const metrics = deps.analyzeRegionTextLikeness(gray, pageWidth, pageHeight, bbox);
	if (deps.isLikelyTextRegion(metrics)) {
		return { allowed: true, score: metrics.textLikeScore, reason: 'text-like' };
	}

	const reasonParts: string[] = [];
	if (metrics.edgeDarkRatio >= metrics.interiorDarkRatio * deps.borderArtifactEdgeBandRatio) {
		reasonParts.push('borderArtifact');
	}
	if (metrics.centerBandDarkRatio < deps.borderArtifactCenterDarkRatioMin) {
		reasonParts.push('weakCenterBand');
	}
	if (metrics.connectedComponentCount < deps.borderArtifactComponentMin) {
		reasonParts.push('fewComponents');
	}
	if (metrics.horizontalPeakCount < deps.borderArtifactHorizontalPeaksMin) {
		reasonParts.push('flatProjection');
	}

	return {
		allowed: false,
		score: metrics.textLikeScore,
		reason: reasonParts.join('+') || 'nonTextRescueBox',
	};
}

export function buildLatinAnchorProbes(
	lines: OCRLine[],
	actualWidth: number,
	actualHeight: number,
	deps: BuildLatinAnchorProbesDeps
): LatinAnchorProbe[] {
	const probes: LatinAnchorProbe[] = [];

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const lineWords = (line.words as OCRWord[]) || [];
		if (lineWords.length === 0) continue;
		const centerY = (line.bbox.y0 + line.bbox.y1) / 2;
		if (centerY > actualHeight * deps.latinAnchorProbeTopCenterYRatioMax) continue;
		const quality = deps.scoreLatinLineReadability(lineWords);
		if (quality < deps.latinAnchorProbeMinLineQuality) continue;
		const lexicalHits = getLatinLexicalHits(lineWords, deps.latinCommonWords, deps.latinShortKeepForLine);
		const normalizedText = deps.normalizeLatinLineText(line.text || '');
		if (lexicalHits < 1 && normalizedText.length < 6) continue;

		const lineHeight = Math.max(1, line.bbox.y1 - line.bbox.y0);
		const medianHeight = deps.getMedianHeight(lineWords);
		const isTopLine = !lines.some(other => {
			if (other === line) return false;
			const verticalGap = line.bbox.y0 - other.bbox.y1;
			const xOverlap = Math.max(0, Math.min(line.bbox.x1, other.bbox.x1) - Math.max(line.bbox.x0, other.bbox.x0));
			return verticalGap >= -medianHeight * 0.5 && verticalGap <= medianHeight * 3.5 && xOverlap > medianHeight * 0.5;
		});

		const isBottomLine = !lines.some(other => {
			if (other === line) return false;
			const verticalGap = other.bbox.y0 - line.bbox.y1;
			const xOverlap = Math.max(0, Math.min(line.bbox.x1, other.bbox.x1) - Math.max(line.bbox.x0, other.bbox.x0));
			return verticalGap >= -medianHeight * 0.5 && verticalGap <= medianHeight * 3.5 && xOverlap > medianHeight * 0.5;
		});

		const xPad = medianHeight * deps.latinAnchorProbeXPadMult;

		if (isBottomLine) {
			const secondLineProbe = deps.clampBBox({
				x0: line.bbox.x0 - xPad,
				x1: line.bbox.x1 + xPad,
				y0: line.bbox.y0 - medianHeight * deps.latinAnchorProbeYPadAbove,
				y1: line.bbox.y1 + medianHeight * deps.latinAnchorProbeYPadBelow,
			}, actualWidth, actualHeight);

			const freeBandHeight = Math.max(0, secondLineProbe.y1 - line.bbox.y1);
			const minFreeBand = lineHeight * 0.7;
			const maxFreeBand = lineHeight * 3.8;
			if (freeBandHeight >= minFreeBand && freeBandHeight <= maxFreeBand) {
				probes.push({
					id: `anchor-second-${index}`,
					anchorLineIndex: index,
					bbox: secondLineProbe,
					probeType: 'anchorSecondLine',
					minConf: Math.max(36, deps.latinLineRescanConf - 12),
					psmOrder: [deps.psmSingleBlock, deps.psmSparseText],
				});
			}
		}

		if (isTopLine) {
			const topSparseProbe = deps.clampBBox({
				x0: line.bbox.x0 - xPad,
				x1: line.bbox.x1 + xPad,
				y0: Math.max(0, line.bbox.y0 - medianHeight * 1.8),
				y1: line.bbox.y1 + medianHeight * 0.85,
			}, actualWidth, actualHeight);

			if (line.bbox.y0 > medianHeight * 0.75) {
				probes.push({
					id: `anchor-top-${index}`,
					anchorLineIndex: index,
					bbox: topSparseProbe,
					probeType: 'anchorTopSparse',
					minConf: Math.max(34, deps.latinTopProbeMinConf - 18),
					psmOrder: [deps.psmSparseText],
				});
			}
		}

		if (isBottomLine && deps.latinBottomProbeEnable) {
			const bottomXPad = medianHeight * deps.latinBottomProbeXPadMult;
			const bottomProbe = deps.clampBBox({
				x0: line.bbox.x0 - bottomXPad,
				x1: line.bbox.x1 + bottomXPad,
				y0: line.bbox.y0 - medianHeight * deps.latinBottomProbeYPadAbove,
				y1: line.bbox.y1 + medianHeight * deps.latinBottomProbeYPadBelow,
			}, actualWidth, actualHeight);

			const lowerFreeBand = Math.max(0, bottomProbe.y1 - line.bbox.y1);
			const minLowerFreeBand = lineHeight * deps.latinBottomProbeMinFreeBandMult;
			const maxLowerFreeBand = lineHeight * deps.latinBottomProbeMaxFreeBandMult;
			if (
				lowerFreeBand >= minLowerFreeBand
				&& lowerFreeBand <= maxLowerFreeBand
				&& line.bbox.y1 < actualHeight - medianHeight * 0.6
			) {
				probes.push({
					id: `anchor-bottom-${index}`,
					anchorLineIndex: index,
					bbox: bottomProbe,
					probeType: 'anchorBottomSparse',
					minConf: deps.latinBottomProbeMinConf,
					psmOrder: [deps.psmSingleBlock, deps.psmSparseText],
				});
			}
		}
	}

	return probes;
}

