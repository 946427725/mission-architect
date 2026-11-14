// Mission Architect desktop build: the same game in its own window, with the
// high-performance GPU requested on dual-GPU laptops and true fullscreen.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

// Ask Windows for the discrete GPU and never fall back to software WebGL.
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Developer test mode: MA_URL loads the dev server, MA_TEST keeps the window
// out of the way (off-screen, never focused) while still rendering.
const TEST = !!process.env.MA_TEST;
if (TEST) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

function createWindow() {
  const win = new BrowserWindow({
    width: TEST ? 1536 : 1600,
    height: TEST ? 864 : 900,
    ...(TEST ? { x: -4000, y: 0, focusable: false, skipTaskbar: true } : {}),
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#05080c',
    title: 'Mission Architect',
    icon: path.join(__dirname, 'app', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => {
    if (TEST) {
      win.showInactive();
      return;
    }
    win.maximize();
    win.show();
  });
  if (process.env.MA_URL) win.loadURL(process.env.MA_URL);
  else win.loadFile(path.join(__dirname, 'app', 'index.html'));
  // links (NASA pages, data sources) open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (/^https?:/.test(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  // F11 toggles fullscreen
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
