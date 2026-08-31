import React from 'react';
import { createPortal } from 'react-dom';
import { FolderPlus, Tag, RefreshCw, Trash2, Folder } from 'lucide-react';
import type { DBTag, DBProject } from '../../../types/electron.d';
import {
  resolveStableAccent,
  type MenuPosition,
  type MenuActionDialogState,
  type DeleteTagDialogState,
  type DeleteProjectDialogState,
} from '../libraryUtils';
import { ProjectContextMenu, TagContextMenu } from '../ContextMenus';
import { SortContextMenu } from '../SortFilterMenu';
import { FolderInfoModal, EditTagModal, CreateProjectModal, EditProjectModal } from '../Modals';
import { BatchOCRBackgroundDialog } from '../Panels/BatchOCRBackgroundDialog';

export interface LibraryModalsProps {
  libraryMenuPosition: MenuPosition | null;
  setLibraryMenuPosition: (pos: MenuPosition | null) => void;
  openProjectDialog: (documentId?: number | null, parentId?: number | null) => void;
  openTagDialog: (documentId?: number | null) => void;
  loadRecentDocuments: () => void;
  activeProjectMenu: { project: DBProject; position: MenuPosition } | null;
  setActiveProjectMenu: (val: { project: DBProject; position: MenuPosition } | null) => void;
  folderInfoProject: DBProject | null;
  setFolderInfoProject: (project: DBProject | null) => void;
  deleteProjectDialog: DeleteProjectDialogState;
  setDeleteProjectDialog: React.Dispatch<React.SetStateAction<DeleteProjectDialogState>>;
  editProjectDialog: { isOpen: boolean; project: DBProject | null; name: string; color: string };
  setEditProjectDialog: React.Dispatch<React.SetStateAction<{ isOpen: boolean; project: DBProject | null; name: string; color: string }>>;
  handleEditProject: () => Promise<void>;
  handleDeleteProject: () => Promise<void>;
  activeTagMenu: { tag: DBTag; position: MenuPosition } | null;
  setActiveTagMenu: (val: { tag: DBTag; position: MenuPosition } | null) => void;
  editTagDialog: { isOpen: boolean; tag: DBTag | null; name: string; color: string };
  setEditTagDialog: React.Dispatch<React.SetStateAction<{ isOpen: boolean; tag: DBTag | null; name: string; color: string }>>;
  handleEditTag: () => Promise<void>;
  deleteTagDialog: DeleteTagDialogState;
  setDeleteTagDialog: React.Dispatch<React.SetStateAction<DeleteTagDialogState>>;
  handleDeleteTag: () => Promise<void>;
  isSortMenuOpen: boolean;
  setIsSortMenuOpen: (val: boolean) => void;
  sortMenuPosition: MenuPosition | null;
  setSortMenuPosition: (pos: MenuPosition | null) => void;
  sortBy: any;
  sortOrder: any;
  ratingFilterMode: 'only' | 'range';
  ratingFilterOnly: number | null;
  ratingFilterMin: number | null;
  ratingFilterMax: number | null;
  activeFilterTag: number | 'no_folder' | null;
  tags: DBTag[];
  setActiveFilterTag: (tag: number | 'no_folder' | null) => void;
  setRatingFilterMode: (mode: 'only' | 'range') => void;
  setRatingFilterOnly: (only: number | null) => void;
  setRatingFilterMin: (min: number | null) => void;
  setRatingFilterMax: (max: number | null) => void;
  setSortBy: (key: any) => void;
  setSortOrder: (order: any) => void;
  ocrBackgroundDialog: any;
  setOcrBackgroundDialog: React.Dispatch<React.SetStateAction<any>>;
  dialogCachePages: number | null;
  handleStartOcrBackground: () => void;
  projectDialog: MenuActionDialogState;
  setProjectDialog: React.Dispatch<React.SetStateAction<MenuActionDialogState>>;
  handleCreateProject: () => Promise<void>;
  tagDialog: MenuActionDialogState;
  setTagDialog: React.Dispatch<React.SetStateAction<MenuActionDialogState>>;
  handleCreateTag: () => Promise<void>;
  importProgress: { current: number; total: number } | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const LibraryModals: React.FC<LibraryModalsProps> = React.memo(({
  libraryMenuPosition,
  setLibraryMenuPosition,
  openProjectDialog,
  openTagDialog,
  loadRecentDocuments,
  activeProjectMenu,
  setActiveProjectMenu,
  folderInfoProject,
  setFolderInfoProject,
  deleteProjectDialog,
  setDeleteProjectDialog,
  editProjectDialog,
  setEditProjectDialog,
  handleEditProject,
  handleDeleteProject,
  activeTagMenu,
  setActiveTagMenu,
  editTagDialog,
  setEditTagDialog,
  handleEditTag,
  deleteTagDialog,
  setDeleteTagDialog,
  handleDeleteTag,
  isSortMenuOpen,
  setIsSortMenuOpen,
  sortMenuPosition,
  setSortMenuPosition,
  sortBy,
  sortOrder,
  ratingFilterMode,
  ratingFilterOnly,
  ratingFilterMin,
  ratingFilterMax,
  activeFilterTag,
  tags,
  setActiveFilterTag,
  setRatingFilterMode,
  setRatingFilterOnly,
  setRatingFilterMin,
  setRatingFilterMax,
  setSortBy,
  setSortOrder,
  ocrBackgroundDialog,
  setOcrBackgroundDialog,
  dialogCachePages,
  handleStartOcrBackground,
  projectDialog,
  setProjectDialog,
  handleCreateProject,
  tagDialog,
  setTagDialog,
  handleCreateTag,
  importProgress,
  fileInputRef,
  handleFileSelect,
}) => {
  return (
    <>
      {libraryMenuPosition && createPortal(
        <div
          data-library-floating-menu="true"
          className="fixed z-[160] w-56 rounded-2xl border border-white/15 bg-slate-950/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
          style={{ left: libraryMenuPosition.x, top: libraryMenuPosition.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            onClick={() => openProjectDialog()}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-white/10"
          >
            <FolderPlus size={14} />
            New Folder
          </button>
          <button
            onClick={() => openTagDialog()}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-white/10"
          >
            <Tag size={14} />
            New Tag
          </button>
          <button
            onClick={() => {
              loadRecentDocuments();
              setLibraryMenuPosition(null);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-white/10"
          >
            <RefreshCw size={14} />
            Refresh Library
          </button>
        </div>,
        document.body
      )}

      {activeProjectMenu && (
        <ProjectContextMenu
          project={activeProjectMenu.project}
          position={activeProjectMenu.position}
          onClose={() => setActiveProjectMenu(null)}
          onShowInfo={() => setFolderInfoProject(activeProjectMenu.project)}
          onDelete={() => {
            setDeleteProjectDialog({
              isOpen: true,
              project: activeProjectMenu.project,
              confirmation: ''
            });
          }}
          onEdit={() => {
            setEditProjectDialog({
              isOpen: true,
              project: activeProjectMenu.project,
              name: activeProjectMenu.project.name,
              color: activeProjectMenu.project.color || resolveStableAccent(activeProjectMenu.project.id)
            });
          }}
          onCreateSubfolder={() => {
            openProjectDialog(null, activeProjectMenu.project.id);
          }}
        />
      )}

      {folderInfoProject && (
        <FolderInfoModal
          project={folderInfoProject}
          onClose={() => setFolderInfoProject(null)}
        />
      )}

      {activeTagMenu && (
        <TagContextMenu
          tag={activeTagMenu.tag}
          position={activeTagMenu.position}
          onClose={() => setActiveTagMenu(null)}
          onEdit={() => {
            setEditTagDialog({
              isOpen: true,
              tag: activeTagMenu.tag,
              name: activeTagMenu.tag.name,
              color: activeTagMenu.tag.color || '#8B5CF6'
            });
          }}
          onDelete={() => {
            setDeleteTagDialog({
              isOpen: true,
              tag: activeTagMenu.tag,
              confirmation: ''
            });
          }}
        />
      )}

      {editTagDialog.isOpen && editTagDialog.tag && (
        <EditTagModal
          isOpen={editTagDialog.isOpen}
          tag={editTagDialog.tag}
          name={editTagDialog.name}
          color={editTagDialog.color}
          onChangeName={(name: string) => setEditTagDialog((prev: typeof editTagDialog) => ({ ...prev, name }))}
          onChangeColor={(color: string) => setEditTagDialog((prev: typeof editTagDialog) => ({ ...prev, color }))}
          onSave={handleEditTag}
          onClose={() => setEditTagDialog({ isOpen: false, tag: null, name: '', color: '' })}
        />
      )}

      {isSortMenuOpen && sortMenuPosition && (
        <SortContextMenu
          position={sortMenuPosition}
          sortBy={sortBy}
          sortOrder={sortOrder}
          ratingFilterMode={ratingFilterMode}
          ratingFilterOnly={ratingFilterOnly}
          ratingFilterMin={ratingFilterMin}
          ratingFilterMax={ratingFilterMax}
          activeFilterTag={activeFilterTag}
          tags={tags}
          onSelectFilterTag={setActiveFilterTag}
          onUpdateFilters={(updates: { mode?: 'only' | 'range'; only?: number | null; min?: number | null; max?: number | null }) => {
            if (updates.mode !== undefined) setRatingFilterMode(updates.mode);
            if (updates.only !== undefined) setRatingFilterOnly(updates.only);
            if (updates.min !== undefined) setRatingFilterMin(updates.min);
            if (updates.max !== undefined) setRatingFilterMax(updates.max);
          }}
          onSelect={(key: any, order: any) => {
            setSortBy(key);
            setSortOrder(order);
          }}
          onClose={() => {
            setIsSortMenuOpen(false);
            setSortMenuPosition(null);
          }}
        />
      )}

      {ocrBackgroundDialog.isOpen && ocrBackgroundDialog.doc && (
        <BatchOCRBackgroundDialog
          isOpen={ocrBackgroundDialog.isOpen}
          doc={ocrBackgroundDialog.doc}
          model={ocrBackgroundDialog.model}
          profile={ocrBackgroundDialog.profile}
          ocrLanguage={ocrBackgroundDialog.ocrLanguage}
          ocrQualityProfile={ocrBackgroundDialog.ocrQualityProfile}
          targetLanguage={ocrBackgroundDialog.targetLanguage}
          dialogCachePages={dialogCachePages}
          onChangeModel={(model: any) => setOcrBackgroundDialog((prev: any) => ({ ...prev, model }))}
          onChangeProfile={(profile: any) => setOcrBackgroundDialog((prev: any) => ({ ...prev, profile }))}
          onChangeOcrLanguage={(ocrLanguage: any) => setOcrBackgroundDialog((prev: any) => ({ ...prev, ocrLanguage }))}
          onChangeOcrQualityProfile={(ocrQualityProfile: any) => setOcrBackgroundDialog((prev: any) => ({ ...prev, ocrQualityProfile }))}
          onChangeTargetLanguage={(targetLanguage: any) => setOcrBackgroundDialog((prev: any) => ({ ...prev, targetLanguage }))}
          onStart={handleStartOcrBackground}
          onClose={() => setOcrBackgroundDialog({ isOpen: false, doc: null, model: 'paddleocr', profile: 'offline_all', ocrLanguage: 'eng', ocrQualityProfile: 'best', targetLanguage: 'th' })}
        />
      )}

      <CreateProjectModal
        isOpen={projectDialog.isOpen}
        name={projectDialog.name}
        color={projectDialog.color || '#38BDF8'}
        parentId={projectDialog.parentId}
        onChangeName={(name: string) => setProjectDialog((current: MenuActionDialogState) => ({ ...current, name }))}
        onChangeColor={(color: string) => setProjectDialog((current: MenuActionDialogState) => ({ ...current, color }))}
        onCreate={() => void handleCreateProject()}
        onClose={() => setProjectDialog({ isOpen: false, name: '', documentId: null, color: '' })}
      />

      <EditProjectModal
        isOpen={editProjectDialog.isOpen && !!editProjectDialog.project}
        name={editProjectDialog.name}
        color={editProjectDialog.color || '#38BDF8'}
        onChangeName={(name: string) => setEditProjectDialog((current: typeof editProjectDialog) => ({ ...current, name }))}
        onChangeColor={(color: string) => setEditProjectDialog((current: typeof editProjectDialog) => ({ ...current, color }))}
        onSave={() => void handleEditProject()}
        onClose={() => setEditProjectDialog({ isOpen: false, project: null, name: '', color: '' })}
      />

      {tagDialog.isOpen && (
        <div className="absolute inset-0 z-[170] flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <h3 className="text-lg font-semibold text-slate-100">Create Tag</h3>
            <p className="mt-1 text-sm text-slate-400">
              Add a reusable tag and optionally assign it to the selected document.
            </p>
            <input
              autoFocus
              type="text"
              value={tagDialog.name}
              onChange={(e) => setTagDialog((current: MenuActionDialogState) => ({ ...current, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleCreateTag();
                }
              }}
              placeholder="Tag name"
              className="mt-5 w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition-colors focus:border-[#FF8705]/60"
            />
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setTagDialog({ isOpen: false, name: '', documentId: null })}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreateTag()}
                className="rounded-xl bg-gradient-to-r from-[#FF8705] to-[#FF7E67] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(255,135,5,0.35)]"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTagDialog.isOpen && deleteTagDialog.tag && (
        <div className="absolute inset-0 z-[175] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-red-400/25 bg-slate-950/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-2xl bg-red-500/12 p-2 text-red-300">
                <Trash2 size={18} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-100">Delete Tag</h3>
                <p className="mt-1 text-sm text-slate-400">
                  This removes the tag label from documents, but does not delete documents, OCR cache, or translated content.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-slate-900/55 p-4">
              <div className="flex items-center gap-2 text-sm text-slate-200">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: deleteTagDialog.tag.color || '#FF8705' }}
                />
                <span className="font-medium">{deleteTagDialog.tag.name}</span>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Type <span className="font-semibold text-slate-200">{deleteTagDialog.tag.name}</span> to confirm deletion.
              </p>
            </div>

            <input
              autoFocus
              type="text"
              value={deleteTagDialog.confirmation}
              onChange={(e) => setDeleteTagDialog((current: DeleteTagDialogState) => ({ ...current, confirmation: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleDeleteTag();
                }
              }}
              placeholder={deleteTagDialog.tag.name}
              className="mt-5 w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition-colors focus:border-red-400/60"
            />

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteTagDialog({ isOpen: false, tag: null, confirmation: '' })}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDeleteTag()}
                disabled={deleteTagDialog.confirmation.trim() !== deleteTagDialog.tag.name}
                className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(239,68,68,0.28)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Delete Tag
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteProjectDialog.isOpen && deleteProjectDialog.project && (
        <div className="absolute inset-0 z-[175] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-red-400/25 bg-slate-950/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-2xl bg-red-500/12 p-2 text-red-300">
                <Trash2 size={18} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-100">Delete Project Folder</h3>
                <p className="mt-1 text-sm text-slate-400">
                  This removes the project folder. Documents in this project will not be deleted, but will be moved out of the project folder.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-slate-900/55 p-4">
              <div className="flex items-center gap-2 text-sm text-slate-200">
                <Folder
                  size={16}
                  style={{ color: resolveStableAccent(deleteProjectDialog.project.id) }}
                />
                <span className="font-medium">{deleteProjectDialog.project.name}</span>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Type <span className="font-semibold text-slate-200">{deleteProjectDialog.project.name}</span> to confirm deletion.
              </p>
            </div>

            <input
              autoFocus
              type="text"
              value={deleteProjectDialog.confirmation}
              onChange={(e) => setDeleteProjectDialog((current: DeleteProjectDialogState) => ({ ...current, confirmation: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleDeleteProject();
                }
              }}
              placeholder={deleteProjectDialog.project.name}
              className="mt-5 w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition-colors focus:border-red-400/60"
            />

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteProjectDialog({ isOpen: false, project: null, confirmation: '' })}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDeleteProject()}
                disabled={deleteProjectDialog.confirmation.trim() !== deleteProjectDialog.project.name}
                className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(239,68,68,0.28)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Delete Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Progress Dialog */}
      {importProgress !== null && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-md">
          <div className="w-96 rounded-3xl border border-white/10 bg-slate-900/90 p-6 shadow-[0_30px_70px_rgba(0,0,0,0.6)] backdrop-blur-2xl flex flex-col items-center text-center gap-4">
            <div className="relative flex items-center justify-center">
              <div className="h-12 w-12 rounded-full border-2 border-white/5 border-t-[#2B9BFF] animate-spin"></div>
              <div className="absolute h-8 w-8 rounded-full border-2 border-white/5 border-b-[#839958] animate-spin [animation-direction:reverse]"></div>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 mb-1">กำลังนำเข้าไฟล์...</h3>
              <p className="text-xs text-slate-400">
                กำลังประมวลผลไฟล์ที่ {importProgress.current} จาก {importProgress.total} ไฟล์
              </p>
            </div>
            <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
              <div 
                className="bg-gradient-to-r from-[#2B9BFF] to-[#839958] h-full transition-all duration-300"
                style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
        onChange={handleFileSelect}
      />
    </>
  );
});

LibraryModals.displayName = 'LibraryModals';
