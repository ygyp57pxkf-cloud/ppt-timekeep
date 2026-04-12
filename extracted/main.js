const { app, BrowserWindow, ipcMain, Menu, Tray, screen, nativeImage } = require('electron');
const path = require('path');

// Fix for transparent window black background issue on Windows
app.disableHardwareAcceleration();

let mainWindow;
let alertWindow;
let tray;
let store;

// Default Settings
const defaultSettings = {
    width: 400,
    height: 200,
    x: undefined,
    y: undefined,
    lastMinutes: 10,
    opacity: 0.8,
    fontSize: 150,
    volume: 0.5
};

async function initStore() {
    const { default: Store } = await import('electron-store');
    store = new Store({ defaults: defaultSettings });
}

function createWindow() {
    // Clear any stored bounds to reset window size
    store.delete('bounds');
    
    const opacity = store.get('opacity') || 0.8;
    const fontSize = store.get('fontSize') || 150;
    
    // Calculate window size based on font size
    const width = Math.max(500, fontSize * 4);
    const height = Math.max(250, fontSize * 1.5);

    mainWindow = new BrowserWindow({
        width: width,
        height: height,
        x: undefined,
        y: undefined,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        focusable: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
        },
        icon: path.join(__dirname, 'icon.png')
    });
    
    // Ensure always on top with highest level
    mainWindow.setAlwaysOnTop(true, 'screen-saver');

    mainWindow.loadFile('index.html');
    
    // Enable mouse pass-through by default, forward events to detect entry
    mainWindow.setIgnoreMouseEvents(true, { forward: true });

    // Save bounds on close/resize/move
    const saveBounds = () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            store.set('bounds', mainWindow.getBounds());
        }
    };
    mainWindow.on('resize', saveBounds);
    mainWindow.on('move', saveBounds);
    mainWindow.on('close', saveBounds);

    // Initial Setup on Load
    mainWindow.webContents.once('did-finish-load', () => {
        const lastMinutes = store.get('lastMinutes') || 10;
        const lastVolume = store.get('volume');
        const lastFontSize = store.get('fontSize') || 150;
        const lastOpacity = store.get('opacity') || 0.8;
        
        mainWindow.webContents.send('timer-set', lastMinutes);
        if (lastVolume !== undefined) {
             mainWindow.webContents.send('timer-set-volume', lastVolume);
        }
        mainWindow.webContents.send('timer-set-fontsize', lastFontSize);
        mainWindow.webContents.send('timer-set-opacity', lastOpacity);
    });
}

function createTray() {
    let icon = nativeImage.createEmpty(); 
    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show/Hide', click: () => {
            if (mainWindow.isVisible()) mainWindow.hide();
            else mainWindow.show();
        }},
        { label: 'Quit', click: () => app.quit() }
    ]);
    tray.setToolTip('PPT Timer');
    tray.setContextMenu(contextMenu);
    
    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) mainWindow.hide();
            else mainWindow.show();
        }
    });
}

// Create fullscreen alert window for "Time's Up"
function showAlertWindow() {
    if (alertWindow && !alertWindow.isDestroyed()) {
        alertWindow.focus();
        return;
    }
    
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    
    alertWindow = new BrowserWindow({
        width: width,
        height: height,
        x: 0,
        y: 0,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        fullscreen: true,
        focusable: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });
    
    // Set alert window on top but below screen-saver level so main timer stays visible
    alertWindow.setAlwaysOnTop(true, 'pop-up-menu');
    
    alertWindow.loadFile('alert.html');
    
    alertWindow.on('closed', () => {
        alertWindow = null;
        // Notify renderer to start overtime counting
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('alert-closed');
        }
    });
}

function closeAlertWindow() {
    if (alertWindow && !alertWindow.isDestroyed()) {
        alertWindow.close();
    }
}

function buildContextMenu() {
    const displays = screen.getAllDisplays();
    const displayItems = displays.map((d, index) => ({
        label: `Display ${index + 1} (${d.bounds.width}x${d.bounds.height})`,
        click: () => {
            if (mainWindow) {
                const x = d.bounds.x + (d.bounds.width - mainWindow.getBounds().width) / 2;
                const y = d.bounds.y + (d.bounds.height - mainWindow.getBounds().height) / 2;
                mainWindow.setPosition(Math.round(x), Math.round(y));
            }
        }
    }));

    const template = [
        {
            label: 'Start/Pause',
            click: () => {
                mainWindow.webContents.send('timer-toggle');
            }
        },
        {
            label: 'Restart',
            click: () => mainWindow.webContents.send('timer-reset')
        },
        { type: 'separator' },
        {
            label: 'Set Time',
            submenu: [
                {
                    label: 'Custom...',
                    click: () => {
                        mainWindow.webContents.send('show-custom-time-input');
                    }
                },
                { type: 'separator' },
                ...[1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120].map(m => ({
                    label: `${m} Minutes`,
                    click: () => {
                        store.set('lastMinutes', m);
                        mainWindow.webContents.send('timer-set', m);
                    }
                }))
            ]
        },
        { type: 'separator' },
        {
            label: 'Font Size',
            submenu: [20, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400].map(s => ({
                label: `${s}px`,
                click: () => {
                    store.set('fontSize', s);
                    mainWindow.webContents.send('timer-set-fontsize', s);
                }
            }))
        },
        { type: 'separator' },
        {
            label: 'Move to Display',
            submenu: displayItems
        },
        { type: 'separator' },
        {
            label: 'Volume',
            submenu: [0, 0.2, 0.5, 0.8, 1.0].map(v => ({
                label: `${v * 100}%`,
                click: () => {
                    store.set('volume', v);
                    mainWindow.webContents.send('timer-set-volume', v);
                }
            }))
        },
        {
            label: 'Opacity',
            submenu: [0.2, 0.4, 0.6, 0.8, 1.0].map(o => ({
                label: `${o * 100}%`,
                click: () => {
                    store.set('opacity', o);
                    mainWindow.webContents.send('timer-set-opacity', o);
                }
            }))
        },
        { label: 'Quit', click: () => app.quit() }
    ];

    return Menu.buildFromTemplate(template);
}

app.whenReady().then(async () => {
    await initStore();
    createWindow();
    createTray();

    ipcMain.on('show-context-menu', () => {
        const menu = buildContextMenu();
        menu.popup(mainWindow);
    });

    ipcMain.on('window-move', (event, { deltaX, deltaY }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            const [x, y] = mainWindow.getPosition();
            mainWindow.setPosition(x + deltaX, y + deltaY);
        }
    });
    
    ipcMain.on('timer-set-custom-relay', (event, minutes) => {
        store.set('lastMinutes', minutes);
        mainWindow.webContents.send('timer-set', minutes);
    });

    ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setIgnoreMouseEvents(ignore, options || {});
        }
    });
    
    ipcMain.on('show-alert-window', () => {
        showAlertWindow();
    });
    
    ipcMain.on('close-alert-window', () => {
        closeAlertWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
