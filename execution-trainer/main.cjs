const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('node:path');
const { Store } = require('./model.cjs');
app.setName('Execution Trainer');
app.setPath('userData', process.env.EXECUTION_TRAINER_DATA || path.join(app.getPath('appData'), 'Execution Trainer'));
let window, store;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => { if (window) { window.restore(); window.focus(); } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    const root = path.join(app.getPath('userData'), 'records');
    const getStore = () => store || (store = new Store(root));
    ipcMain.handle('trainer', (event, action, input) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return { error: '请求来源无效。' };
      try {
        const current = getStore();
        let selected;
        if (action === 'create') selected = current.create(input);
        else if (action === 'complete') current.complete(input);
        else if (action !== 'list') throw new Error('不支持这个操作。');
        return { trainings: current.list(), selected };
      } catch (error) {
        console.error(error);
        return { error: error.code ? '记录未能保存，请检查磁盘空间和数据目录权限，然后重试。' : error.message };
      }
    });
    ipcMain.handle('window-action', (event, action) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
      if (action === 'minimize') window.minimize();
      if (action === 'close') window.close();
    });
    function open() {
      window = new BrowserWindow({ width: 420, height: 480, minWidth: 380, minHeight: 440, title: 'Execution Trainer', frame:false, backgroundColor: '#101012', autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.loadFile(path.join(__dirname, 'index.html'));
      if (process.env.EXECUTION_TRAINER_DATA) window.webContents.on('page-title-updated', event => { event.preventDefault(); window.setTitle('Execution Trainer · 隔离测试'); });
    }
    open();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) open(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
