import React from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import type { DBDocument } from '../../../types/electron.d';
import type { FileOpenErrorEntry } from '../libraryUtils';
import { getFileOpenHint } from '../libraryUtils';

export interface FileOpenErrorBannerProps {
  fileOpenError: FileOpenErrorEntry | null;
  documents: DBDocument[];
  handleOpenDocument: (doc: DBDocument) => void;
  handleBrowse: () => void;
  handleDeleteDocument: (docId: number) => Promise<void>;
  setFileOpenError: (error: FileOpenErrorEntry | null) => void;
}

export const FileOpenErrorBanner: React.FC<FileOpenErrorBannerProps> = React.memo(({
  fileOpenError,
  documents,
  handleOpenDocument,
  handleBrowse,
  handleDeleteDocument,
  setFileOpenError,
}) => {
  if (!fileOpenError) return null;

  return (
    <div className="mx-4 mt-4 mb-2 rounded-xl border border-amber-400/45 bg-amber-400/12 backdrop-blur-xl px-4 py-3 text-sm text-amber-100 flex items-start gap-3">
      <div className="mt-0.5 text-amber-300">
        <AlertTriangle size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold">Open failed</span>
          <span className="text-[10px] text-amber-200/80">
            {new Date(fileOpenError.timestamp).toLocaleString()}
          </span>
        </div>
        <p className="text-[11px] text-amber-100/90 mt-1">
          {fileOpenError.filename ? `${fileOpenError.filename} — ` : ''}
          {fileOpenError.message}
        </p>
        <p className="text-[11px] text-amber-100/70 mt-1">
          {getFileOpenHint(fileOpenError.message)}
        </p>
        {fileOpenError.filepath && (
          <p className="text-[10px] text-amber-100/65 mt-1 truncate">
            {fileOpenError.filepath}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {fileOpenError.context === 'recent' && fileOpenError.docId !== undefined ? (
            <>
              <button
                onClick={() => {
                  const doc = documents.find(d => d.id === fileOpenError.docId);
                  if (doc) {
                    handleOpenDocument(doc);
                  } else {
                    handleBrowse();
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-amber-300 text-slate-900 text-xs font-semibold hover:bg-amber-200 transition-colors flex items-center gap-1"
              >
                <RefreshCw size={12} /> Retry
              </button>
              <button
                onClick={async () => {
                  if (fileOpenError.docId !== undefined) {
                    await handleDeleteDocument(fileOpenError.docId);
                  }
                  setFileOpenError(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-900/75 border border-white/10 text-amber-100 text-xs hover:bg-slate-800 transition-colors"
              >
                Remove from Recent
              </button>
            </>
          ) : (
            <button
              onClick={handleBrowse}
              className="px-3 py-1.5 rounded-lg bg-amber-300 text-slate-900 text-xs font-semibold hover:bg-amber-200 transition-colors flex items-center gap-1"
            >
              <RefreshCw size={12} /> Browse Again
            </button>
          )}
          <button
            onClick={() => setFileOpenError(null)}
            className="px-3 py-1.5 rounded-lg bg-slate-900/75 border border-white/10 text-amber-100 text-xs hover:bg-slate-800 transition-colors flex items-center gap-1"
          >
            <X size={12} /> Dismiss
          </button>
        </div>
      </div>
    </div>
  );
});

FileOpenErrorBanner.displayName = 'FileOpenErrorBanner';
