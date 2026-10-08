import { BrowserWindow, Menu, clipboard, session } from 'electron';

const SCHEME = 'npf71b963c1b7b6d119';

/**
 * Abre el inicio de sesión de Nintendo Account y resuelve con la URL
 * npf71b963c1b7b6d119://auth#session_token_code=... cuando el usuario pulsa
 * "Elegir a esta persona".
 */
export function openNintendoLogin(parent, authoriseUrl) {
    return new Promise((resolve, reject) => {
        const ses = session.fromPartition('nso-login-' + Date.now());
        let settled = false;

        const win = new BrowserWindow({
            parent,
            modal: true,
            width: 1000,
            height: 800,
            title: 'Nintendo Account — cuenta secundaria',
            autoHideMenuBar: true,
            backgroundColor: '#ffffff',
            webPreferences: { session: ses, contextIsolation: true, sandbox: true },
        });

        const finish = url => {
            if (settled) return;
            settled = true;
            resolve(url);
            setImmediate(() => !win.isDestroyed() && win.close());
        };
        const isRedirect = url => url.toLowerCase().startsWith(SCHEME + ':');

        ses.protocol.handle(SCHEME, request => {
            finish(request.url);
            return new Response('<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px">Sesión iniciada. Ya puedes cerrar esta ventana.</body>', {
                headers: { 'content-type': 'text/html; charset=utf-8' },
            });
        });

        win.webContents.on('will-navigate', (event, url) => {
            if (isRedirect(url)) { event.preventDefault(); finish(url); }
        });
        win.webContents.on('will-redirect', (event, url) => {
            if (isRedirect(url)) { event.preventDefault(); finish(url); }
        });
        win.webContents.setWindowOpenHandler(({ url }) => {
            if (isRedirect(url)) finish(url);
            return { action: 'deny' };
        });

        // Electron no trae menú contextual: sin esto no se puede copiar el enlace de "Elegir a esta persona".
        win.webContents.on('context-menu', (event, params) => {
            const items = [];
            if (params.linkURL) {
                if (isRedirect(params.linkURL)) items.push({ label: 'Usar este enlace para iniciar sesión', click: () => finish(params.linkURL) });
                items.push({ label: 'Copiar dirección del enlace', click: () => clipboard.writeText(params.linkURL) });
            }
            if (params.isEditable) items.push({ role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' });
            else if (params.selectionText) items.push({ role: 'copy', label: 'Copiar' });
            if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
        });

        win.on('closed', () => {
            if (!settled) {
                settled = true;
                const err = new Error('Inicio de sesión cancelado');
                err.code = 'CANCELLED';
                reject(err);
            }
        });

        const userAgent = win.webContents.getUserAgent().replace(/\s(Electron|reactor-nsw2-rpc|NSW2 Presence)\/\S+/g, '');
        win.loadURL(authoriseUrl, { userAgent });
    });
}
