import React, { useEffect, useState } from 'react';
import type { OCRPageResult } from '../../types';
import { visionService } from '../../services/vision/VisionService';

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
  image: string;
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

export const OCRRegressionHarness: React.FC = () => {
  const [status, setStatus] = useState<HarnessStatus>('idle');
  const [fixtureId, setFixtureId] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<OCRPageResult | null>(null);
  const [manifest, setManifest] = useState<OCRFixtureManifest | null>(null);
  const [expectation, setExpectation] = useState<OCRFixtureExpectation | null>(null);

  useEffect(() => {
    const target = window as HarnessWindow;
    const setHarnessResult = (payload: Record<string, unknown>) => {
      target.__OCR_REGRESSION_RESULT__ = payload;
    };

    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const requestedFixture = params.get('fixture') || '';
      setFixtureId(requestedFixture);
      setStatus('loading');
      setHarnessResult({ status: 'loading', fixture: requestedFixture });

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

        const imageResponse = await fetch(`/${fixture.image.replace(/^\/+/, '')}`, { cache: 'no-store' });
        if (!imageResponse.ok) {
          throw new Error(`Fixture image missing: ${fixture.image}`);
        }

        setStatus('running');
        setHarnessResult({ status: 'running', fixture: fixture.id, page: fixture.page });

        const imageBlob = await imageResponse.blob();
        const imageUrl = await blobToDataUrl(imageBlob);
        const { width, height } = await getImageSize(imageUrl);
        const ocrResult = await visionService.ocrForTextLayer(
          imageUrl,
          width,
          height,
          fixture.language || 'eng',
          fixture.dpi || 300,
          undefined,
          undefined,
          true,
          'panel'
        );

        ocrResult.pageNumber = fixture.page;
        ocrResult.pipelineProfile = 'panel';
        setResult(ocrResult);
        setStatus('done');
        setHarnessResult({
          status: 'done',
          fixture: fixture.id,
          page: fixture.page,
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
