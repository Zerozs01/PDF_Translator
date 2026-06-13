import React, { useEffect, useState } from 'react';
import type { OCREngine, OCRPageResult, OCRPipelineProfile, OCRQualityProfile } from '../../types';
import { visionService } from '../../services/vision/VisionService';
import { pdfjs } from '../../services/pdf/pdfjsWorker';

type HarnessStatus = 'idle' | 'loading' | 'running' | 'done' | 'error';

interface OCRFixtureExpectation {
  page: number;
  minLines: number;
  minMeaningfulWords: number;
  mustContainAny: string[][];
  mustNotContainNormalized: string[];
  maxStandaloneShortTokens: number;
  maxSuspiciousRatio: number;
}

interface OCRFixtureCase {
  id: string;
  page: number;
  image?: string;
  pdf?: string;
  pdfPage?: number;
  language?: string;
  dpi?: number;
}

interface OCRFixtureManifest {
  cases: OCRFixtureCase[];
  expectations: OCRFixtureExpectation[];
}

interface HarnessWindow extends Window {
  __OCR_REGRESSION_RESULT__?: unknown;
}

const HARNESS_ENGINES: readonly OCREngine[] = ['paddleocr', 'easyocr'];
const HARNESS_PIPELINES: readonly OCRPipelineProfile[] = ['panel', 'export'];
const HARNESS_QUALITY: readonly OCRQualityProfile[] = ['fast', 'balanced', 'best'];

function normalizeHarnessEngine(value: string | null): OCREngine {
  const normalized = String(value || 'paddleocr').toLowerCase();
  return HARNESS_ENGINES.includes(normalized as OCREngine)
    ? (normalized as OCREngine)
    : 'paddleocr';
}

function normalizeHarnessPipeline(value: string | null): OCRPipelineProfile {
  const normalized = String(value || 'panel').toLowerCase();
  return HARNESS_PIPELINES.includes(normalized as OCRPipelineProfile)
    ? (normalized as OCRPipelineProfile)
    : 'panel';
}

function normalizeHarnessQuality(value: string | null): OCRQualityProfile {
  const normalized = String(value || 'best').toLowerCase();
  return HARNESS_QUALITY.includes(normalized as OCRQualityProfile)
    ? (normalized as OCRQualityProfile)
    : 'best';
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

async function getImageSize(imageUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.width, height: image.height });
    image.onerror = () => reject(new Error(`Failed to load image: ${imageUrl}`));
    image.src = imageUrl;
  });
}

async function renderPdfFixturePageToDataUrl(
  pdfBlob: Blob,
  pageNum: number,
  dpi: number
): Promise<{ imageUrl: string; width: number; height: number }> {
  const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const pdfDocument = await loadingTask.promise;
  const requestedPage = Number.isFinite(pageNum) ? Math.floor(pageNum) : 1;
  const safePage = Math.max(1, Math.min(pdfDocument.numPages, requestedPage));
  const page = await pdfDocument.getPage(safePage);

  try {
    const baseScale = Math.max(0.5, (dpi || 300) / 72);
    const baseViewport = page.getViewport({ scale: baseScale });
    const maxSide = 3600;
    const maxPixels = 13_000_000;
    let scaleAdjust = 1;

    if (Math.max(baseViewport.width, baseViewport.height) > maxSide) {
      scaleAdjust = Math.min(scaleAdjust, maxSide / Math.max(baseViewport.width, baseViewport.height));
    }
    if (baseViewport.width * baseViewport.height > maxPixels) {
      scaleAdjust = Math.min(scaleAdjust, Math.sqrt(maxPixels / (baseViewport.width * baseViewport.height)));
    }

    const viewport = scaleAdjust < 1
      ? page.getViewport({ scale: baseScale * scaleAdjust })
      : baseViewport;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Failed to create canvas context for PDF fixture render');

    await page.render({ canvas, canvasContext: context, viewport, intent: 'print' }).promise;

    return {
      imageUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    page.cleanup();
    await loadingTask.destroy();
    pdfDocument.destroy();
  }
}

export const OCRRegressionHarness: React.FC = () => {
  const [status, setStatus] = useState<HarnessStatus>('idle');
  const [fixtureId, setFixtureId] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<OCRPageResult | null>(null);
  const [manifest, setManifest] = useState<OCRFixtureManifest | null>(null);
  const [expectation, setExpectation] = useState<OCRFixtureExpectation | null>(null);
  const [engine, setEngine] = useState<OCREngine>('paddleocr');
  const [pipelineProfile, setPipelineProfile] = useState<OCRPipelineProfile>('panel');
  const [qualityProfile, setQualityProfile] = useState<OCRQualityProfile>('best');

  useEffect(() => {
    const target = window as HarnessWindow;
    const setHarnessResult = (payload: Record<string, unknown>) => {
      target.__OCR_REGRESSION_RESULT__ = payload;
    };

    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const requestedFixture = params.get('fixture') || '';
      const selectedEngine = normalizeHarnessEngine(params.get('engine'));
      const selectedPipeline = normalizeHarnessPipeline(params.get('pipeline'));
      const selectedQuality = normalizeHarnessQuality(params.get('quality'));
      const configParam = params.get('config');
      // no_fallback=1: fail-fast mode for benchmark — do NOT silently return Tesseract
      // results when the requested engine is unavailable (no electronAPI bridge).
      const noFallback = params.get('no_fallback') === '1';
      setEngine(selectedEngine);
      setPipelineProfile(selectedPipeline);
      setQualityProfile(selectedQuality);
      setFixtureId(requestedFixture);
      setStatus('loading');
      setHarnessResult({
        status: 'loading',
        fixture: requestedFixture,
        engine: selectedEngine,
        pipelineProfile: selectedPipeline,
        qualityProfile: selectedQuality,
      });

      try {
        await visionService.initialize();

        const manifestResponse = await fetch('/fixtures/ocr/manga/expectations.json', { cache: 'no-store' });
        if (!manifestResponse.ok) {
          throw new Error(`Fixture manifest not found: ${manifestResponse.status}`);
        }
        const manifestData = await manifestResponse.json() as OCRFixtureManifest;
        setManifest(manifestData);

        const fixture = manifestData.cases.find((entry) => entry.id === requestedFixture);
        if (!fixture) {
          throw new Error(`Unknown fixture: ${requestedFixture || '(missing fixture query param)'}`);
        }

        const expectationEntry = manifestData.expectations.find((entry) => entry.page === fixture.page) || null;
        setExpectation(expectationEntry);

        let sourceImageUrl = '';
        let sourceWidth = 0;
        let sourceHeight = 0;

        if (fixture.image) {
          const imageResponse = await fetch(`/${fixture.image.replace(/^\/+/, '')}`, { cache: 'no-store' });
          if (!imageResponse.ok) {
            throw new Error(`Fixture image missing: ${fixture.image}`);
          }
          const imageBlob = await imageResponse.blob();
          sourceImageUrl = await blobToDataUrl(imageBlob);
          const dims = await getImageSize(sourceImageUrl);
          sourceWidth = dims.width;
          sourceHeight = dims.height;
        } else if (fixture.pdf) {
          const pdfResponse = await fetch(`/${fixture.pdf.replace(/^\/+/, '')}`, { cache: 'no-store' });
          if (!pdfResponse.ok) {
            throw new Error(`Fixture PDF missing: ${fixture.pdf}`);
          }
          const pdfBlob = await pdfResponse.blob();
          const rendered = await renderPdfFixturePageToDataUrl(
            pdfBlob,
            fixture.pdfPage || fixture.page || 1,
            fixture.dpi || 300
          );
          sourceImageUrl = rendered.imageUrl;
          sourceWidth = rendered.width;
          sourceHeight = rendered.height;
        } else {
          throw new Error(`Fixture ${fixture.id} is missing both image and pdf fields`);
        }

        setStatus('running');
        setHarnessResult({
          status: 'running',
          fixture: fixture.id,
          page: fixture.page,
          engine: selectedEngine,
          pipelineProfile: selectedPipeline,
          qualityProfile: selectedQuality,
        });

        const rawConfig = {
          engine: 'paddle', // Hardcoded as primary
          preprocessing: {
            enabled: false, // Bypass all filters
            binarization: false,
            deskew: false
          },
          postprocessing: {
            heuristics: false // No text correction
          }
        };

        const optimizedConfig = {
          engine: 'paddle',
          preprocessing: {
            enabled: true, // Apply rules from ocr_preprocessing_rules.md
            binarization: true,
            deskew: true
          },
          postprocessing: {
            heuristics: true, // Enable Thai repair patterns
            glossary: true    // Apply translation_glossary_seed.md
          }
        };

        const configObj = configParam === 'raw'
          ? rawConfig
          : (configParam === 'optimized' ? optimizedConfig : undefined);

        const ocrResult = await visionService.ocrForTextLayer(
          sourceImageUrl,
          sourceWidth,
          sourceHeight,
          fixture.language || 'eng',
          fixture.dpi || 300,
          undefined,
          undefined,
          true,
          selectedPipeline,
          selectedQuality,
          selectedEngine,
          undefined,
          configObj
        );

        // Detect silent fallback: VisionService sets debug.fallbackFromEngine = the
        // originally-requested engine (e.g. 'paddleocr') when it was unavailable and
        // easyocr was silently used instead.
        // IMPORTANT: fellBackFrom holds the *requested* engine, NOT the fallback engine.
        // So the presence of fellBackFrom alone means a fallback occurred — we must NOT
        // compare it to selectedEngine (they would be equal and hide the issue).
        const debugInfo = ocrResult.debug as Record<string, unknown> | undefined;
        const fellBackFrom = debugInfo?.fallbackFromEngine as string | undefined;
        if (noFallback && fellBackFrom) {
          throw new Error(
            `engine_unavailable:${selectedEngine} -- fell back to easyocr `
          );
        }

        ocrResult.pageNumber = fixture.page;
        ocrResult.pipelineProfile = selectedPipeline;
        ocrResult.ocrEngine = selectedEngine;
        ocrResult.ocrQualityProfile = selectedQuality;
        setResult(ocrResult);
        setStatus('done');
        setHarnessResult({
          status: 'done',
          fixture: fixture.id,
          page: fixture.page,
          engine: selectedEngine,
          pipelineProfile: selectedPipeline,
          qualityProfile: selectedQuality,
          expectation: expectationEntry,
          ocr: ocrResult,
        });
      } catch (runError) {
        const message = runError instanceof Error ? runError.message : 'Unknown OCR harness error';
        setError(message);
        setStatus('error');
        setHarnessResult({
          status: 'error',
          fixture: requestedFixture,
          engine: selectedEngine,
          pipelineProfile: selectedPipeline,
          qualityProfile: selectedQuality,
          error: message,
        });
      }
    };

    run();
  }, []);

  return (
    <div className="min-h-screen bg-[#060a14] text-slate-100 p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
          <h1 className="text-lg font-semibold">OCR Regression Harness</h1>
          <p className="text-sm text-slate-400 mt-2">
            fixture: <span className="text-slate-200">{fixtureId || '(none)'}</span>
          </p>
          <p className="text-sm text-slate-400">
            status: <span className="text-slate-200">{status}</span>
          </p>
          <p className="text-sm text-slate-400">
            engine: <span className="text-slate-200">{engine}</span> / pipeline: <span className="text-slate-200">{pipelineProfile}</span> / quality: <span className="text-slate-200">{qualityProfile}</span>
          </p>
          {error && <p className="text-sm text-red-300 mt-2">{error}</p>}
        </div>

        {manifest && (
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4 text-sm text-slate-300">
            loaded fixtures: {manifest.cases.length}
          </div>
        )}

        {expectation && (
          <div className="rounded-xl border border-sky-700/40 bg-sky-950/20 p-4 text-sm text-sky-100">
            expectation page {expectation.page}: minLines {expectation.minLines}, minMeaningfulWords {expectation.minMeaningfulWords}
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
          <pre className="text-xs text-slate-300 whitespace-pre-wrap break-all">
            {JSON.stringify(
              result
                ? {
                  page: result.pageNumber,
                  words: result.words.length,
                  lines: result.lines.length,
                  confidence: Number(result.confidence.toFixed(2)),
                  text: result.text,
                  debug: result.debug,
                }
                : { status, error },
              null,
              2
            )}
          </pre>
        </div>
      </div>
    </div>
  );
};
