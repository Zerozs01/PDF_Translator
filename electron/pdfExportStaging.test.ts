import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildPdfExportSourceUrl,
  cleanupStagedPdfExportJob,
  resolvePdfExportProtocolPath,
  stagePdfExportJob,
} from './pdfExportStaging';

describe('pdfExportStaging protocol URLs', () => {
  const jobId = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(async () => {
    await cleanupStagedPdfExportJob(jobId);
  });

  afterEach(async () => {
    await cleanupStagedPdfExportJob(jobId);
  });

  it('builds and resolves pdf-export source URLs', async () => {
    const stagingDir = path.join(os.tmpdir(), 'pdf-translator-export', jobId);
    await stagePdfExportJob({
      jobId,
      fileType: 'pdf',
      sourceBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      pages: [],
    });

    const sourceUrl = buildPdfExportSourceUrl(jobId);
    expect(sourceUrl).toBe(`pdf-export://${encodeURIComponent(jobId)}/source`);

    const resolvedPath = resolvePdfExportProtocolPath(sourceUrl);
    expect(resolvedPath).toBe(path.join(stagingDir, 'source.pdf'));
    expect(resolvedPath && fs.existsSync(resolvedPath)).toBe(true);
  });

  it('returns null for unknown jobs', () => {
    expect(resolvePdfExportProtocolPath('pdf-export://missing-job-id/source')).toBeNull();
  });
});
