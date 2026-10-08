import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, nativeTheme, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Store from './store.js';
import NsoService, { describeError } from './nso.js';
import Tracker, { buildActivity } from './tracker.js';
import DiscordPresence from './discord.js';
import { openNintendoLogin } from './auth-window.js';
import { demoFriends, DEMO_HISTORY } from './demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

const MIN_POLL = 20;
const MAX_POLL = 300;
const MIN_MANUAL_REFRESH_GAP = 10_000;

/** Modo demo: datos simulados y configuración aparte, sin tocar Nintendo. */
const DEMO = process.env.NSW2_DEMO === '1' || process.argv.includes('--demo');
const DEMO_STARTED_AT = Date.now();
if (DEMO) app.setPath('userData', path.join(app.getPath('appData'), 'reactor-nsw2-rpc-demo'));

/** Al arrancar con Windows la app empieza oculta en la bandeja. */
const START_HIDDEN = process.argv.includes('--hidden');

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('reactor.nsw2.rpc');

let win = null;
let tray = null;
let quitting = false;
let trayHintShown = false;
let store, nso, tracker, discord;
let pollTimer = null;
let polling = false;
let failures = 0;
let pendingAuth = null;
let lastView = null;

const state = {
    status: 'loading',
    loading: false,
    friend: null,
    friends: [],
    game: null,
    session: null,
    presenceUpdatedAt: null,
    logoutAt: null,
    activity: null,
    error: null,
    lastUpdate: null,
    nextPollAt: null,
};

function computeSetup() {
    const cfg = store.data;
    const steps = {
        consent: !!cfg.consentAccepted,
        clientId: !!cfg.nxapiClientId?.trim(),
        login: DEMO || !!store.getSecret('sessionToken'),
        friend: !!cfg.friendNsaId,
        discord: !!cfg.discordClientId?.trim(),
    };
    return { ...steps, ready: steps.consent && steps.clientId && steps.login };
}

function snapshot() {
    const setup = computeSetup();
    return {
        ...state,
        config: { ...store.publicConfig(), loggedIn: setup.login },
        setup,
        discord: discord.status,
        recent: tracker.recent(state.game),
        canOpenAtLogin: canOpenAtLogin(),
        now: Date.now(),
    };
}

function broadcast() {
    if (win && !win.isDestroyed()) win.webContents.send('state', snapshot());
}

function pollInterval() {
    return Math.min(MAX_POLL, Math.max(MIN_POLL, Number(store.get('pollInterval')) || 30));
}

function refreshActivity() {
    const cfg = store.data;
    state.activity = lastView && cfg.rpcEnabled ? buildActivity(lastView, state.friend, cfg) : null;
    discord.setActivity(state.activity);
}

function schedule(seconds) {
    clearTimeout(pollTimer);
    state.nextPollAt = Date.now() + seconds * 1000;
    pollTimer = setTimeout(poll, seconds * 1000);
}

async function poll() {
    clearTimeout(pollTimer);
    if (polling) return;

    const setup = computeSetup();
    if (!setup.ready) {
        state.status = 'setup';
        state.game = null;
        state.session = null;
        lastView = null;
        refreshActivity();
        state.nextPollAt = null;
        broadcast();
        return;
    }

    polling = true;
    state.loading = true;
    broadcast();

    try {
        const friends = DEMO ? demoFriends(DEMO_STARTED_AT) : await nso.getFriends();
        const cfg = store.data;

        state.friends = friends.map(f => ({
            nsaId: f.nsaId,
            name: f.name,
            imageUri: f.imageUri,
            isFavoriteFriend: !!f.isFavoriteFriend,
            state: f.presence?.state ?? 'OFFLINE',
            gameName: f.presence?.game?.name ?? null,
            platform: f.presence?.platform ?? null,
        }));

        const friend = friends.find(f => f.nsaId === cfg.friendNsaId);
        if (!friend) {
            state.status = cfg.friendNsaId ? 'friend-missing' : 'no-friend';
            state.friend = null;
            state.game = null;
            state.session = null;
            lastView = null;
        } else {
            const view = tracker.update(friend, Date.now(), pollInterval());
            lastView = view;
            state.friend = { nsaId: friend.nsaId, name: friend.name, imageUri: friend.imageUri };
            state.status = view.status;
            state.game = view.game;
            state.session = view.session;
            state.presenceUpdatedAt = friend.presence?.updatedAt ?? null;
            state.logoutAt = friend.presence?.logoutAt ?? null;
        }

        refreshActivity();
        state.error = null;
        failures = 0;
    } catch (err) {
        console.error('[poll]', err);
        failures++;
        state.error = describeError(err);
        if (err.code === 'LOGIN_REQUIRED') state.status = 'setup';
        else if (state.status === 'loading') state.status = 'error';
        // Si Nintendo lleva varios minutos sin responder, no dejamos una actividad obsoleta en Discord.
        if (failures >= 4) discord.setActivity(null);
    } finally {
        polling = false;
        state.loading = false;
        state.lastUpdate = Date.now();
    }

    const base = pollInterval();
    schedule(failures ? Math.min(base * 2 ** failures, 600) : base);
    broadcast();
}

function resetTracking() {
    tracker.endSession();
    tracker.lastPollAt = null;
    lastView = null;
    state.game = null;
    state.session = null;
    state.friend = null;
}

function applyConfig(patch) {
    const clean = {};
    const has = key => Object.prototype.hasOwnProperty.call(patch, key);

    if (has('consentAccepted')) clean.consentAccepted = !!patch.consentAccepted;
    if (has('nxapiClientId')) clean.nxapiClientId = String(patch.nxapiClientId ?? '').trim();
    if (has('discordClientId')) clean.discordClientId = String(patch.discordClientId ?? '').replace(/\D/g, '');
    if (has('friendNsaId')) clean.friendNsaId = String(patch.friendNsaId ?? '');
    if (has('pollInterval')) clean.pollInterval = Math.min(MAX_POLL, Math.max(MIN_POLL, Number(patch.pollInterval) || 30));
    if (has('theme') && ['system', 'light', 'dark'].includes(patch.theme)) clean.theme = patch.theme;
    if (has('rpcEnabled')) clean.rpcEnabled = !!patch.rpcEnabled;
    if (has('openAtLogin')) clean.openAtLogin = !!patch.openAtLogin;
    if (has('closeToTray')) clean.closeToTray = !!patch.closeToTray;
    if (has('presence') && patch.presence && typeof patch.presence === 'object') {
        const p = {};
        for (const key of ['showDescription', 'showTotal', 'showElapsed', 'showFirstPlayed', 'showShopButton', 'showWhenInactive']) {
            if (key in patch.presence) p[key] = !!patch.presence[key];
        }
        if (['avatar', 'platform', 'none'].includes(patch.presence.smallImage)) p.smallImage = patch.presence.smallImage;
        if (['details', 'name'].includes(patch.presence.statusDisplay)) p.statusDisplay = patch.presence.statusDisplay;
        clean.presence = p;
    }

    const before = { ...store.data };
    store.set(clean);

    if ('theme' in clean) nativeTheme.themeSource = clean.theme;
    if ('nxapiClientId' in clean && clean.nxapiClientId !== before.nxapiClientId) nso.configureClient();
    if ('discordClientId' in clean) discord.setClientId(clean.discordClientId);
    if ('friendNsaId' in clean && clean.friendNsaId !== before.friendNsaId) resetTracking();
    if ('openAtLogin' in clean) applyLoginItem();
    if ('openAtLogin' in clean || 'rpcEnabled' in clean) updateTrayMenu();

    refreshActivity();

    const needsPoll = ['consentAccepted', 'nxapiClientId', 'friendNsaId', 'pollInterval'].some(k => k in clean && clean[k] !== before[k]);
    if (needsPoll) poll();
    else broadcast();

    return snapshot();
}

function registerIpc() {
    ipcMain.handle('state:get', () => snapshot());
    ipcMain.handle('config:set', (_e, patch) => applyConfig(patch ?? {}));

    ipcMain.handle('poll:refresh', () => {
        if (state.lastUpdate && Date.now() - state.lastUpdate < MIN_MANUAL_REFRESH_GAP) return snapshot();
        poll();
        return snapshot();
    });

    ipcMain.handle('auth:login', async () => {
        if (DEMO) return { ok: false, error: 'No disponible en modo demo.' };
        if (!pendingAuth) pendingAuth = nso.createAuthorisation();
        const auth = pendingAuth;
        try {
            const url = await openNintendoLogin(win, auth.authorise_url);
            await nso.completeLogin(auth, url);
            pendingAuth = null;
            failures = 0;
            poll();
            return { ok: true };
        } catch (err) {
            if (err.code === 'CANCELLED') return { ok: false, cancelled: true };
            console.error('[auth]', err);
            if (auth.result) pendingAuth = null;
            return { ok: false, error: describeError(err) };
        } finally {
            broadcast();
        }
    });

    ipcMain.handle('auth:login-url', async (_e, url) => {
        if (DEMO) return { ok: false, error: 'No disponible en modo demo.' };
        if (!pendingAuth) return { ok: false, error: 'Primero pulsa "Iniciar sesión" para generar un enlace de Nintendo.' };
        const auth = pendingAuth;
        try {
            if (!/^npf71b963c1b7b6d119:\/\/auth/i.test(String(url).trim())) throw new Error('El enlace debe empezar por npf71b963c1b7b6d119://auth');
            await nso.completeLogin(auth, url);
            pendingAuth = null;
            failures = 0;
            poll();
            return { ok: true };
        } catch (err) {
            console.error('[auth]', err);
            if (auth.result) pendingAuth = null;
            return { ok: false, error: describeError(err) };
        } finally {
            broadcast();
        }
    });

    ipcMain.handle('auth:logout', () => {
        nso.logout();
        resetTracking();
        state.friends = [];
        state.error = null;
        poll();
        return snapshot();
    });

    ipcMain.handle('shell:open', (_e, url) => {
        if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
    });

    ipcMain.handle('shell:open-assets', () => shell.openPath(discordAssetsDir()));

    ipcMain.on('window:minimize', () => win?.minimize());
    ipcMain.on('window:toggle-maximize', () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()));
    ipcMain.on('window:close', () => win?.close());
}

function createWindow({ show = !START_HIDDEN } = {}) {
    nativeTheme.themeSource = store.get('theme') ?? 'system';

    win = new BrowserWindow({
        width: 1080,
        height: 700,
        minWidth: 900,
        minHeight: 620,
        frame: false,
        show: false,
        title: 'NSW2 Presence',
        icon: path.join(ROOT, 'assets', 'icon.png'),
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1c1e' : '#ebebeb',
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https:\/\//.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', event => event.preventDefault());

    win.once('ready-to-show', () => show && win.show());
    if (process.env.NSW2_SCREENSHOT) captureForDev(process.env.NSW2_SCREENSHOT);
    win.on('close', event => {
        if (quitting || !store.get('closeToTray')) return;
        // Cerrar la ventana solo la oculta: la app sigue publicando la actividad desde la bandeja.
        event.preventDefault();
        win.hide();
        if (!trayHintShown && tray) {
            trayHintShown = true;
            tray.displayBalloon({ iconType: 'info', title: 'NSW2 Presence sigue activo', content: 'La app continúa en segundo plano. Ábrela o ciérrala desde el icono de la bandeja.' });
        }
    });
    win.on('closed', () => win = null);
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function showWindow() {
    if (!win) return createWindow({ show: true });
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

function quitApp() {
    quitting = true;
    app.quit();
}

function createTray() {
    const image = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png')).resize({ width: 16, height: 16 });
    tray = new Tray(image);
    tray.setToolTip('NSW2 Presence');
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
    updateTrayMenu();
}

function updateTrayMenu() {
    if (!tray) return;
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Abrir NSW2 Presence', click: showWindow },
        { type: 'separator' },
        { label: 'Mostrar Rich Presence', type: 'checkbox', checked: !!store.get('rpcEnabled'), click: item => applyConfig({ rpcEnabled: item.checked }) },
        { label: 'Iniciar con Windows', type: 'checkbox', checked: !!store.get('openAtLogin'), enabled: canOpenAtLogin(), click: item => applyConfig({ openAtLogin: item.checked }) },
        { type: 'separator' },
        { label: 'Salir', click: quitApp },
    ]));
}

/** Ruta del .exe que debe abrir Windows al iniciar sesión (en la versión portable, el archivo original y no la copia temporal). */
function executablePath() {
    return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function canOpenAtLogin() {
    return app.isPackaged && !DEMO;
}

function applyLoginItem() {
    if (!canOpenAtLogin()) return;
    // Se vuelve a registrar en cada arranque: si el .exe se movió, la entrada de inicio apunta a la nueva ubicación.
    app.setLoginItemSettings({ openAtLogin: !!store.get('openAtLogin'), path: executablePath(), args: ['--hidden'] });
}

function discordAssetsDir() {
    return app.isPackaged ? path.join(process.resourcesPath, 'discord') : path.join(ROOT, 'assets', 'discord');
}

/** Solo desarrollo: guarda una captura de la ventana y cierra la app. */
function captureForDev(file) {
    win.webContents.once('did-finish-load', async () => {
        await new Promise(r => setTimeout(r, 2500));
        if (process.env.NSW2_SCREENSHOT_JS) {
            await win.webContents.executeJavaScript(process.env.NSW2_SCREENSHOT_JS);
            await new Promise(r => setTimeout(r, 900));
        }
        const image = await win.webContents.capturePage();
        fs.writeFileSync(file, image.toPNG());
        app.quit();
    });
}

app.on('second-instance', () => {
    if (app.isReady() && store) showWindow();
});

app.whenReady().then(() => {
    store = new Store();
    if (DEMO) {
        store.set({ consentAccepted: true, nxapiClientId: 'demo', friendNsaId: store.get('friendNsaId') || 'demo-main' });
        if (!store.get('history')?.length) store.set({ history: DEMO_HISTORY });
    }
    nso = new NsoService(store);
    tracker = new Tracker(store);
    discord = new DiscordPresence();
    discord.on('change', broadcast);
    discord.setClientId(store.get('discordClientId'));

    registerIpc();
    createWindow();
    createTray();
    applyLoginItem();
    poll();
});

app.on('window-all-closed', () => {
    if (!store?.get('closeToTray')) quitApp();
});

app.on('before-quit', () => {
    quitting = true;
    clearTimeout(pollTimer);
    discord?.disconnect();
});
