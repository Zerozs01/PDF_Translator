import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import type { PdfPrintExportFileType, PdfPrintExportPageConfig } from '../src/types/pdfExport';

export type StagedPdfExportManifest = {
  jobId: string;
  fileType: PdfPrintExportFileType;
  sourceMimeType?: string;
  sourcePath: string;
  pagesPath: string;
  stagingDir: string;
};

export type StagePdfExportJobInput = {
  jobId: string;
  fileType: PdfPrintExportFileType;
  sourceMimeType?: string;
  sourceFilePath?: string | null;
  sourceBytes?: Uint8Array | ArrayBuffer | null;
  pages: PdfPrintExportPageConfig[];
};

const stagedJobs = new Map<string, StagedPdfExportManifest>();

const resolveSourceExtension = (fileType: PdfPrintExportFileType, sourceMimeType?: string): string => {
  if (fileType === 'pdf') return '.pdf';
  if (sourceMimeType?.includes('jpeg')) return '.jpg';
  if (sourceMimeType?.includes('webp')) return '.webp';
  return '.png';
};

export const getStagedPdfExportJob = (jobId: string): StagedPdfExportManifest | undefined =>
  stagedJobs.get(jobId);

export const stagePdfExportJob = async (input: StagePdfExportJobInput): Promise<StagedPdfExportManifest> => {
  const stagingDir = path.join(os.tmpdir(), 'pdf-translator-export', input.jobId);
  await fs.mkdir(stagingDir, { recursive: true });

  const pagesPath = path.join(stagingDir, 'pages.json');
  await fs.writeFile(pagesPath, JSON.stringify(input.pages), 'utf8');

  const sourceExt = resolveSourceExtension(input.fileType, input.sourceMimeType);
  const sourcePath = path.join(stagingDir, `source${sourceExt}`);

  if (input.sourceFilePath && fsSync.existsSync(input.sourceFilePath)) {
    await fs.copyFile(input.sourceFilePath, sourcePath);
  } else if (input.sourceBytes) {
    const bytes = input.sourceBytes instanceof Uint8Array
      ? input.sourceBytes
      : new Uint8Array(input.sourceBytes);
    await fs.writeFile(sourcePath, bytes);
  } else {
    throw new Error('PDF export requires a source file path or source bytes.');
  }

  const manifest: StagedPdfExportManifest = {
    jobId: input.jobId,
    fileType: input.fileType,
    sourceMimeType: input.sourceMimeType,
    sourcePath,
    pagesPath,
    stagingDir,
  };

  stagedJobs.set(input.jobId, manifest);
  return manifest;
};

export const readStagedPdfExportPages = async (manifest: StagedPdfExportManifest): Promise<PdfPrintExportPageConfig[]> => {
  const raw = await fs.readFile(manifest.pagesPath, 'utf8');
  return JSON.parse(raw) as PdfPrintExportPageConfig[];
};

export const cleanupStagedPdfExportJob = async (jobId: string): Promise<void> => {
  const manifest = stagedJobs.get(jobId);
  stagedJobs.delete(jobId);
  if (!manifest) return;

  try {
    await fs.rm(manifest.stagingDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
};

export const buildPdfExportSourceUrl = (jobId: string): string =>
  `pdf-export://${encodeURIComponent(jobId)}/source`;

export const resolvePdfExportProtocolPath = (requestUrl: string): string | null => {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== 'pdf-export:') return null;
    if (url.pathname !== '/source') return null;

    const jobId = decodeURIComponent(url.hostname);
    if (!jobId) return null;

    const manifest = stagedJobs.get(jobId);
    if (!manifest || !fsSync.existsSync(manifest.sourcePath)) return null;
    return manifest.sourcePath;
  } catch {
    return null;
  }
};

export const disposeAllStagedPdfExportJobs = async (): Promise<void> => {
  const jobIds = Array.from(stagedJobs.keys());
  await Promise.all(jobIds.map((jobId) => cleanupStagedPdfExportJob(jobId)));
};
