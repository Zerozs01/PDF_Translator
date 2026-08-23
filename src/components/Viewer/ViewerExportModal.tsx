import React, { useState } from 'react';

interface ViewerExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (options: {
    format: 'pdf' | 'png' | 'zip';
    includeOriginal: boolean;
    pages: 'all' | 'current';
  }) => void;
  currentPage: number;
  totalPages: number;
  isExporting?: boolean;
}

export const ViewerExportModal: React.FC<ViewerExportModalProps> = ({
  isOpen,
  onClose,
  onExport,
  currentPage,
  totalPages,
  isExporting = false,
}) => {
  const [format, setFormat] = useState<'pdf' | 'png' | 'zip'>('pdf');
  const [includeOriginal, setIncludeOriginal] = useState<boolean>(false);
  const [pages, setPages] = useState<'all' | 'current'>('all');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onExport({ format, includeOriginal, pages });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 text-slate-100 shadow-2xl">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <span>📤</span> Export Document
        </h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Export Format */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">Export Format</label>
            <div className="grid grid-cols-3 gap-3">
              {(['pdf', 'png', 'zip'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setFormat(fmt)}
                  className={`py-2 px-3 rounded-xl border text-sm font-semibold uppercase transition-all ${
                    format === fmt
                      ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/30'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>

          {/* Page Range */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">Page Range</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPages('all')}
                className={`py-2 px-3 rounded-xl border text-sm font-medium transition-all ${
                  pages === 'all'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                }`}
              >
                All Pages ({totalPages})
              </button>
              <button
                type="button"
                onClick={() => setPages('current')}
                className={`py-2 px-3 rounded-xl border text-sm font-medium transition-all ${
                  pages === 'current'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                }`}
              >
                Current Page ({currentPage})
              </button>
            </div>
          </div>

          {/* Options */}
          <div className="flex items-center gap-3 pt-2">
            <input
              type="checkbox"
              id="includeOriginal"
              checked={includeOriginal}
              onChange={(e) => setIncludeOriginal(e.target.checked)}
              className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="includeOriginal" className="text-sm text-slate-300 cursor-pointer">
              Include original un-translated side-by-side
            </label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isExporting}
              className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isExporting}
              className="px-5 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-xl shadow-lg shadow-blue-600/30 transition-all flex items-center gap-2"
            >
              {isExporting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Exporting...</span>
                </>
              ) : (
                <span>Export Now</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
