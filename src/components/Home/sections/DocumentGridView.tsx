import React from 'react';
import { 
  Upload, Folder, ChevronRight, FolderPlus, Clock, FileText, Eye, EyeOff 
} from 'lucide-react';
import type { DBDocument, DBTag, DBProject } from '../../../types/electron.d';
import type { ViewMode as FileBrowserViewMode } from '../../../stores/useFileBrowserStore';
import { DocumentCard } from '../DocumentCard';
import { resolveStableAccent, hexToRgba, formatDate, getFileIcon } from '../libraryUtils';

export interface DocumentGridViewProps {
  isLoading: boolean;
  sortedDocuments: DBDocument[];
  currentSubprojects: DBProject[];
  viewMode: FileBrowserViewMode;
  selectedProjectId: number | null;
  projectDropTargetId: number | null;
  setProjectDropTargetId: (id: number | null) => void;
  draggedProjectIdRef: React.MutableRefObject<number | null>;
  setDraggedProjectId: (id: number | null) => void;
  setActiveProjectMenu: (val: any) => void;
  loadDocumentsByProject: (id: number) => void;
  openProjectMenu: (proj: DBProject, e: React.MouseEvent<HTMLElement>) => void;
  handleDropOnProject: (projId: number | null, e?: React.DragEvent) => Promise<void>;
  selectedDocumentIds: Set<number>;
  handleOpenDocument: (doc: DBDocument) => void;
  handleCardClick: (doc: DBDocument, index: number, e: React.MouseEvent) => void;
  handleCheckboxClick: (doc: DBDocument, e: React.MouseEvent) => void;
  handleToggleFavorite: (docId: number) => Promise<void>;
  handleDeleteDocument: (docId: number) => Promise<void>;
  activeDocumentMenuId: number | null;
  activeDocumentMenuPosition: { x: number; y: number } | null;
  documentTagsById: Record<number, DBTag[]>;
  tags: DBTag[];
  projects: DBProject[];
  openDocumentMenu: (docId: number, pos: { x: number; y: number }) => void;
  setActiveDocumentMenuId: (id: number | null) => void;
  setActiveDocumentMenuPosition: (pos: { x: number; y: number } | null) => void;
  handleToggleDocumentTag: (doc: DBDocument, tag: DBTag) => Promise<void>;
  handleMoveDocumentToProject: (doc: DBDocument, projId: number | null) => Promise<void>;
  toggleDocumentSelection: (docId: number) => void;
  openTagDialog: (documentId?: number | null) => void;
  setDraggedDocumentId: (id: number | null) => void;
  setDraggedDocumentIds: (ids: number[]) => void;
  setLibraryMenuPosition: (pos: { x: number; y: number } | null) => void;
  hiddenThumbnails: Set<number>;
  toggleHideThumbnail: (docId: number) => void;
  openOcrBackgroundDialog: (doc: DBDocument) => void;
  handleUpdateRating: (doc: DBDocument, rating: number) => Promise<void>;
  isDragging: boolean;
  setIsDragging: (val: boolean) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleBrowse: () => void;
  openProjectDialog: (documentId?: number | null, parentId?: number | null) => void;
  documents: DBDocument[];
}

export const DocumentGridView: React.FC<DocumentGridViewProps> = React.memo(({
  isLoading,
  sortedDocuments,
  currentSubprojects,
  viewMode,
  selectedProjectId,
  projectDropTargetId,
  setProjectDropTargetId,
  draggedProjectIdRef,
  setDraggedProjectId,
  setActiveProjectMenu,
  loadDocumentsByProject,
  openProjectMenu,
  handleDropOnProject,
  selectedDocumentIds,
  handleOpenDocument,
  handleCardClick,
  handleCheckboxClick,
  handleToggleFavorite,
  handleDeleteDocument,
  activeDocumentMenuId,
  activeDocumentMenuPosition,
  documentTagsById,
  tags,
  projects,
  openDocumentMenu,
  setActiveDocumentMenuId,
  setActiveDocumentMenuPosition,
  handleToggleDocumentTag,
  handleMoveDocumentToProject,
  toggleDocumentSelection,
  openTagDialog,
  setDraggedDocumentId,
  setDraggedDocumentIds,
  setLibraryMenuPosition,
  hiddenThumbnails,
  toggleHideThumbnail,
  openOcrBackgroundDialog,
  handleUpdateRating,
  isDragging,
  setIsDragging,
  handleDrop,
  handleBrowse,
  openProjectDialog,
  documents,
}) => {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-slate-300/80"></div>
      </div>
    );
  }

  if (sortedDocuments.length > 0 || currentSubprojects.length > 0) {
    return (
      <div className="h-full overflow-y-auto pr-1 custom-scrollbar pb-20">
        {/* 📂 Render Folder Grid/List first */}
        {viewMode === 'grid' ? (
          currentSubprojects.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
              {currentSubprojects.map((subproj) => {
                const accent = subproj.color || resolveStableAccent(subproj.id);
                const isDropTarget = projectDropTargetId === subproj.id;
                return (
                  <div
                    key={subproj.id}
                    draggable={true}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', `project:${subproj.id}`);
                      event.dataTransfer.setData('application/x-project-id', String(subproj.id));
                      event.dataTransfer.effectAllowed = 'move';
                      draggedProjectIdRef.current = subproj.id;
                      setDraggedProjectId(subproj.id);
                      setActiveProjectMenu(null);

                      const dragGhost = document.createElement('div');
                      dragGhost.style.position = 'absolute';
                      dragGhost.style.top = '-9999px';
                      dragGhost.style.left = '-9999px';
                      dragGhost.style.padding = '6px 12px';
                      dragGhost.style.background = '#0284c7';
                      dragGhost.style.color = '#ffffff';
                      dragGhost.style.fontSize = '12px';
                      dragGhost.style.fontWeight = 'bold';
                      dragGhost.style.borderRadius = '10px';
                      dragGhost.style.boxShadow = '0 4px 14px rgba(0,0,0,0.4)';
                      dragGhost.innerText = `📁 ${subproj.name}`;
                      document.body.appendChild(dragGhost);
                      event.dataTransfer.setDragImage(dragGhost, 10, 10);
                      setTimeout(() => {
                        if (document.body.contains(dragGhost)) {
                          document.body.removeChild(dragGhost);
                        }
                      }, 0);
                    }}
                    onDragEnd={() => {
                      draggedProjectIdRef.current = null;
                      setDraggedProjectId(null);
                      setProjectDropTargetId(null);
                    }}
                    onClick={() => {
                      loadDocumentsByProject(subproj.id);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openProjectMenu(subproj, e);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      event.dataTransfer.dropEffect = 'move';
                      setProjectDropTargetId(subproj.id);
                    }}
                    onDragLeave={(event) => {
                      event.stopPropagation();
                      if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                      if (projectDropTargetId === subproj.id) {
                        setProjectDropTargetId(null);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void handleDropOnProject(subproj.id, event);
                    }}
                    className={`group relative px-3 py-2 rounded-xl border transition-all flex items-center gap-2.5 cursor-pointer select-none overflow-hidden ${
                      isDropTarget
                        ? 'border-sky-400 bg-sky-500/20 shadow-[0_0_20px_rgba(56,189,248,0.4)] scale-[1.01]'
                        : 'border-white/8 hover:border-white/18 bg-[#16181c]/80 hover:bg-[#1c1f26] shadow-sm hover:shadow-md'
                    }`}
                  >
                    <div 
                      className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 border border-white/10 transition-transform duration-200 group-hover:scale-105 shadow-inner"
                      style={{ 
                        backgroundColor: hexToRgba(accent, 0.16),
                        boxShadow: `0 1px 4px ${hexToRgba(accent, 0.2)}`
                      }}
                    >
                      <Folder size={14} style={{ color: accent }} />
                    </div>

                    <span className="flex-1 truncate text-xs font-semibold text-slate-100 group-hover:text-white transition-colors" title={subproj.name}>
                      {subproj.name}
                    </span>

                    <ChevronRight size={12} className="text-slate-500 group-hover:text-slate-300 group-hover:translate-x-0.5 transition-all shrink-0" />
                  </div>
                );
              })}
            </div>
          )
        ) : (
          currentSubprojects.length > 0 && (
            <div className="space-y-1">
              {currentSubprojects.map((subproj) => {
                const accent = subproj.color || resolveStableAccent(subproj.id);
                const isDropTarget = projectDropTargetId === subproj.id;
                return (
                  <div
                    key={subproj.id}
                    draggable={true}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', `project:${subproj.id}`);
                      event.dataTransfer.setData('application/x-project-id', String(subproj.id));
                      event.dataTransfer.effectAllowed = 'move';
                      draggedProjectIdRef.current = subproj.id;
                      setDraggedProjectId(subproj.id);
                      setActiveProjectMenu(null);

                      const dragGhost = document.createElement('div');
                      dragGhost.style.position = 'absolute';
                      dragGhost.style.top = '-9999px';
                      dragGhost.style.left = '-9999px';
                      dragGhost.style.padding = '6px 12px';
                      dragGhost.style.background = '#0284c7';
                      dragGhost.style.color = '#ffffff';
                      dragGhost.style.fontSize = '12px';
                      dragGhost.style.fontWeight = 'bold';
                      dragGhost.style.borderRadius = '10px';
                      dragGhost.style.boxShadow = '0 4px 14px rgba(0,0,0,0.4)';
                      dragGhost.innerText = `📁 ${subproj.name}`;
                      document.body.appendChild(dragGhost);
                      event.dataTransfer.setDragImage(dragGhost, 10, 10);
                      setTimeout(() => {
                        if (document.body.contains(dragGhost)) {
                          document.body.removeChild(dragGhost);
                        }
                      }, 0);
                    }}
                    onDragEnd={() => {
                      draggedProjectIdRef.current = null;
                      setDraggedProjectId(null);
                      setProjectDropTargetId(null);
                    }}
                    onClick={() => {
                      loadDocumentsByProject(subproj.id);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openProjectMenu(subproj, e);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      event.dataTransfer.dropEffect = 'move';
                      setProjectDropTargetId(subproj.id);
                    }}
                    onDragLeave={(event) => {
                      event.stopPropagation();
                      if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                      if (projectDropTargetId === subproj.id) {
                        setProjectDropTargetId(null);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void handleDropOnProject(subproj.id, event);
                    }}
                    className={`group px-3 py-2 rounded-xl border transition-all flex items-center gap-2.5 cursor-pointer select-none ${
                      isDropTarget
                        ? 'border-sky-400 bg-sky-500/20 shadow-[0_0_20px_rgba(56,189,248,0.35)] scale-[1.01]'
                        : 'border-white/6 hover:border-white/15 bg-[#16181c]/70 hover:bg-[#1b1e24]'
                    }`}
                  >
                    <div 
                      className="h-7 w-7 rounded-lg shrink-0 flex items-center justify-center transition-transform group-hover:scale-105 border border-white/5"
                      style={{ backgroundColor: hexToRgba(accent, 0.16) }}
                    >
                      <Folder size={14} style={{ color: accent }} />
                    </div>
                    <span className="flex-1 truncate text-xs font-semibold text-slate-200 group-hover:text-white">{subproj.name}</span>
                    <ChevronRight size={12} className="text-slate-600 group-hover:text-slate-300 transition-colors shrink-0" />
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* Subtle section divider line between Folders and Files when both exist */}
        {currentSubprojects.length > 0 && sortedDocuments.length > 0 && (
          <div className="h-px bg-white/6 my-3 w-full shrink-0" />
        )}

        {/* 📄 Render Documents Grid/List */}
        {sortedDocuments.length > 0 ? (
          <div className={viewMode === 'grid'
            ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
            : 'space-y-2'
          }>
            {sortedDocuments.map((doc, index) => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                viewMode={viewMode}
                isSelected={selectedDocumentIds.has(doc.id)}
                isMultiSelectActive={selectedDocumentIds.size > 0}
                onOpen={() => handleOpenDocument(doc)}
                onCardClick={(e) => handleCardClick(doc, index, e)}
                onCheckboxClick={(e) => handleCheckboxClick(doc, e)}
                onToggleFavorite={() => void handleToggleFavorite(doc.id)}
                onDelete={() => void handleDeleteDocument(doc.id)}
                isMenuOpen={activeDocumentMenuId === doc.id}
                menuPosition={activeDocumentMenuPosition}
                documentTags={documentTagsById[doc.id] ?? []}
                tags={tags}
                projects={projects}
                onRequestMenu={(position) => void openDocumentMenu(doc.id, position)}
                onCloseMenu={() => {
                  setActiveDocumentMenuId(null);
                  setActiveDocumentMenuPosition(null);
                }}
                onToggleTag={(tag) => void handleToggleDocumentTag(doc, tag)}
                onMoveToProject={(projectId) => void handleMoveDocumentToProject(doc, projectId)}
                onToggleSelect={() => toggleDocumentSelection(doc.id)}
                onCreateTag={() => openTagDialog(doc.id)}
                onDragStart={(e) => {
                  const isTargetSelected = selectedDocumentIds.has(doc.id);
                  const ids = isTargetSelected && selectedDocumentIds.size > 0
                    ? Array.from(selectedDocumentIds)
                    : [doc.id];
                  const payload = JSON.stringify(ids);
                  e.dataTransfer.setData('application/x-document-ids', payload);
                  e.dataTransfer.setData('text/plain', payload);
                  e.dataTransfer.effectAllowed = 'move';
                  
                  if (ids.length > 1) {
                    const dragGhost = document.createElement('div');
                    dragGhost.style.position = 'absolute';
                    dragGhost.style.top = '-9999px';
                    dragGhost.style.left = '-9999px';
                    dragGhost.style.padding = '6px 12px';
                    dragGhost.style.background = '#0284c7';
                    dragGhost.style.color = '#ffffff';
                    dragGhost.style.fontSize = '12px';
                    dragGhost.style.fontWeight = 'bold';
                    dragGhost.style.borderRadius = '12px';
                    dragGhost.style.boxShadow = '0 4px 14px rgba(0,0,0,0.4)';
                    dragGhost.style.zIndex = '99999';
                    dragGhost.innerText = `📄 ย้าย ${ids.length} รายการ`;
                    document.body.appendChild(dragGhost);
                    e.dataTransfer.setDragImage(dragGhost, 15, 15);
                    setTimeout(() => {
                      if (document.body.contains(dragGhost)) {
                        document.body.removeChild(dragGhost);
                      }
                    }, 0);
                  }

                  setDraggedDocumentId(doc.id);
                  setDraggedDocumentIds(ids);
                  setActiveDocumentMenuId(null);
                  setActiveDocumentMenuPosition(null);
                  setLibraryMenuPosition(null);
                }}
                onDragEnd={() => {
                  setDraggedDocumentId(null);
                  setDraggedDocumentIds([]);
                  setProjectDropTargetId(null);
                }}
                isThumbnailHidden={hiddenThumbnails.has(doc.id)}
                onToggleHideThumbnail={() => toggleHideThumbnail(doc.id)}
                onOCRAllPages={() => openOcrBackgroundDialog(doc)}
                onUpdateRating={(rating) => void handleUpdateRating(doc, rating)}
              />
            ))}
          </div>
        ) : (
          currentSubprojects.length > 0 && (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className="rounded-3xl border-2 border-dashed border-white/8 bg-[#16181c]/40 p-8 flex flex-col items-center justify-center text-center mt-3 backdrop-blur-xl select-none group hover:border-white/15 transition-all"
            >
              <div className="h-12 w-12 rounded-2xl bg-white/[0.04] border border-white/8 flex items-center justify-center text-slate-400 mb-3 group-hover:scale-105 transition-transform">
                <FolderPlus size={22} className="text-sky-400/80" />
              </div>
              <h4 className="text-sm font-semibold text-slate-200 mb-1">
                โฟลเดอร์นี้ยังไม่มีเอกสาร
              </h4>
              <p className="text-xs text-slate-400 max-w-sm mb-4">
                ลากไฟล์มาวางที่นี่เพื่อเพิ่มไฟล์เข้าโฟลเดอร์นี้ หรือเลือกนำเข้าไฟล์ใหม่
              </p>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={handleBrowse}
                  className="px-4 py-2 rounded-xl bg-[#23272e] hover:bg-[#2b3038] text-white border border-white/10 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                >
                  <Upload size={13} />
                  <span>Import Files</span>
                </button>
                <button
                  onClick={() => openProjectDialog(null, selectedProjectId)}
                  className="px-4 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white border border-white/8 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <FolderPlus size={13} className="text-sky-400" />
                  <span>+ Subfolder</span>
                </button>
              </div>
            </div>
          )
        )}
      </div>
    );
  }

  if (selectedProjectId !== null) {
    // Dedicated Empty State when inside a Folder with no subfolders and no documents
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`w-full max-w-lg rounded-3xl border-2 border-dashed flex flex-col items-center justify-center p-10 transition-all duration-300 backdrop-blur-xl text-center ${
            isDragging
              ? 'border-sky-400 bg-sky-500/10 scale-[1.015] shadow-[0_24px_60px_rgba(56,189,248,0.2)]'
              : 'border-white/10 bg-[#17191d]/75 hover:border-white/16'
          }`}
        >
          <div 
            className="p-5 rounded-2xl border border-white/10 mb-4 shadow-xl"
            style={{ 
              backgroundColor: hexToRgba(projects.find(p => p.id === selectedProjectId)?.color || '#38BDF8', 0.14) 
            }}
          >
            <Folder size={40} style={{ color: projects.find(p => p.id === selectedProjectId)?.color || '#38BDF8' }} />
          </div>
          <h3 className="text-lg font-bold text-slate-100 mb-1.5">
            {projects.find(p => p.id === selectedProjectId)?.name || 'Folder'}
          </h3>
          <p className="text-slate-400 mb-6 text-xs max-w-xs">
            โฟลเดอร์นี้ว่างอยู่ ลากไฟล์ PDF หรือรูปภาพมาวางที่นี่ หรือสร้างโฟลเดอร์ย่อย
          </p>

          <div className="flex items-center gap-3">
            <button
              onClick={handleBrowse}
              className="px-5 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white rounded-xl font-bold cursor-pointer transition-all text-xs shadow-lg flex items-center gap-2"
            >
              <Upload size={14} />
              Browse / Import
            </button>
            <button
              onClick={() => openProjectDialog(null, selectedProjectId)}
              className="px-4 py-2.5 bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 hover:text-white rounded-xl font-semibold cursor-pointer transition-all border border-white/10 text-xs flex items-center gap-1.5"
            >
              <FolderPlus size={14} className="text-sky-400" />
              Create Subfolder
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Empty State / Upload Area with Recent Files for Root Library
  return (
    <div className="h-full flex flex-col">
      {/* Recent Files Section */}
      {documents.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
            <Clock size={14} className="text-slate-300" />
            Recent Files
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {documents.slice(0, 5).map(doc => {
              const isHidden = hiddenThumbnails.has(doc.id);
              return (
                <div
                  key={doc.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleOpenDocument(doc)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleOpenDocument(doc); }}
                  className="flex items-center gap-3 p-3 rounded-xl bg-[#17191d]/78 border border-white/8 hover:border-white/12 hover:bg-[#1d2025] transition-all text-left group backdrop-blur-xl relative cursor-pointer select-none"
                >
                  <div className="h-14 w-10 overflow-hidden rounded-lg bg-[#111214]/90 border border-white/5 group-hover:border-white/10 flex items-center justify-center shrink-0 relative">
                    {isHidden ? (
                      <div className="h-full w-full bg-[#f8fafc] border border-slate-200 shadow-inner flex items-center justify-center relative overflow-hidden">
                        <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:6px_6px] opacity-25" />
                        <FileText size={14} className="text-slate-300 relative z-10" />
                      </div>
                    ) : doc.thumbnail_path ? (
                      <img src={doc.thumbnail_path} alt={doc.filename} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        {getFileIcon(doc.file_type)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-100 truncate">{doc.filename}</p>
                    <p className="text-[10px] text-slate-400">{formatDate(doc.last_accessed)}</p>
                  </div>
                  
                  {/* Toggle Button for Privacy on hover */}
                  <button 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      toggleHideThumbnail(doc.id); 
                    }}
                    className={`absolute top-2 right-2 p-1 rounded-md transition-all z-10 ${
                      isHidden 
                        ? 'bg-[#839958] text-white border border-[#839958]' 
                        : 'bg-[#111214]/90 text-slate-500 border border-white/5 opacity-0 group-hover:opacity-100 hover:text-slate-200'
                    }`}
                    title={isHidden ? 'แสดงรูปภาพตัวอย่าง' : 'ซ่อนรูปภาพตัวอย่าง'}
                  >
                    {isHidden ? <EyeOff size={10} /> : <Eye size={10} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upload Area */}
      <div className="flex-1 flex items-center justify-center">
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`w-full max-w-xl aspect-video rounded-3xl border-2 border-dashed flex flex-col items-center justify-center transition-all duration-300 backdrop-blur-xl ${
            isDragging
              ? 'border-white/20 bg-white/[0.04] scale-[1.015] shadow-[0_24px_60px_rgba(0,0,0,0.22)]'
              : 'border-white/12 bg-[#17191d]/68 hover:border-white/16'
          }`}
        >
          <div className="p-5 rounded-full bg-slate-900/85 border border-white/10 mb-5 shadow-2xl">
            <Upload size={40} className="text-slate-200" />
          </div>
          <h3 className="text-xl font-bold mb-2">
            {documents.length === 0 ? 'No documents yet' : 'No results found'}
          </h3>
          <p className="text-slate-400 mb-6 text-sm">
            {documents.length === 0
              ? 'Drag & drop PDF or images to get started'
              : 'Try a different search term or filter'
            }
          </p>

          <button
            onClick={handleBrowse}
            className="px-6 py-2.5 bg-[#262a30] hover:bg-[#2d3138] text-white rounded-xl font-bold cursor-pointer transition-all border border-white/10 text-sm"
          >
            Browse Files
          </button>
        </div>
      </div>
    </div>
  );
});

DocumentGridView.displayName = 'DocumentGridView';
