import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { initDB, DocumentDAO, OCRCacheDAO } from './db'

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.js
// │
process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null
// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC || '', 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(process.env.DIST || '', 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  // Initialize SQLite Database with Performance Pragmas
  initDB();

  // Register IPC Handlers for Database Operations
  ipcMain.handle('db:save-document', async (_, { filepath, filename, totalPages }) => {
    try {
      return DocumentDAO.upsert(filepath, filename, totalPages);
    } catch (error) {
      console.error('db:save-document error:', error);
      throw error;
    }
  });

  ipcMain.handle('db:get-document', async (_, filepath) => {
    try {
      return DocumentDAO.get(filepath);
    } catch (error) {
      console.error('db:get-document error:', error);
      return null;
    }
  });

  ipcMain.handle('db:save-ocr', async (_, { docId, pageNum, data }) => {
    try {
      OCRCacheDAO.save(docId, pageNum, data);
      return true;
    } catch (error) {
      console.error('db:save-ocr error:', error);
      return false;
    }
  });

  ipcMain.handle('db:get-ocr', async (_, { docId, pageNum }) => {
    try {
      return OCRCacheDAO.get(docId, pageNum);
    } catch (error) {
      console.error('db:get-ocr error:', error);
      return null;
    }
  });

  createWindow();
})
