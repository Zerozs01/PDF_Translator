import React from 'react';
import { useSyncScroll } from '../../hooks/useSyncScroll';
import { useUIStore } from '../../stores/useUIStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { PDFCanvas } from '../PDF/PDFCanvas';
import { ImageCanvas } from '../Image/ImageCanvas';

interface DocumentRendererProps {
  dataSource: 'original_ocr_cache' | 'translated_cache' | 'global_preview_mode';
  renderMode: 'single' | 'scroll';
}

const DocumentRenderer: React.FC<DocumentRendererProps> = ({ dataSource, renderMode }) => {
  const file = useProjectStore((s) => s.file);
  if (!file) return null;

  const previewMode = dataSource === 'global_preview_mode'
    ? undefined
    : (dataSource === 'original_ocr_cache' ? 'original' : 'translated');

  return (
    <React.Suspense fallback={<div className="flex items-center justify-center h-full text-slate-500">Loading Canvas...</div>}>
      {file.type === 'application/pdf' ? (
        <PDFCanvas previewModeOverride={previewMode} />
      ) : (
        <ImageCanvas previewModeOverride={previewMode} />
      )}
    </React.Suspense>
  );
};

export const WorkspaceContainer = () => {
  const { viewMode, pageMode } = useUIStore(); // pageMode: 'single' | 'scroll'
  const { leftRef, rightRef } = useSyncScroll();

  return (
    <div className="workspace-viewport animate-fade-in" style={{ display: 'flex', width: '100%', height: '100%' }}>
      
      <div 
        ref={viewMode === 'split' && pageMode === 'scroll' ? leftRef : null}
        className="original-ocr-pane"
        style={{ flex: viewMode === 'split' ? '1' : '0 0 100%', height: '100%', overflowY: 'auto', position: 'relative' }}
      >
        <DocumentRenderer 
          dataSource={viewMode === 'split' ? "original_ocr_cache" : "global_preview_mode"} 
          renderMode={pageMode}
        />
      </div>

      {viewMode === 'split' && (
        <div 
          ref={pageMode === 'scroll' ? rightRef : null}
          className="translated-result-pane"
          style={{ flex: '1', height: '100%', overflowY: 'auto', borderLeft: '1px solid rgba(255,255,255,0.1)', position: 'relative' }}
        >
          <DocumentRenderer dataSource="translated_cache" renderMode={pageMode}/>
        </div>
      )}

    </div>
  );
};
