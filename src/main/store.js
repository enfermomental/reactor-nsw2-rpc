import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
    consentAccepted: false,
    nxapiClientId: '',
    discordClientId: '',
    friendNsaId: '',
    pollInterval: 30,
    theme: 'system',
    rpcEnabled: true,
    openAtLogin: true,
    closeToTray: true,
    presence: {
        showDescription: true,
        showTotal: true,
        showElapsed: true,
        showFirstPlayed: true,
        showShopButton: true,
        showWhenInactive: false,
        smallImage: 'avatar', // avatar | platform | none
        statusDisplay: 'details', // details | name
    },
    account: null,
    lastSession: null,
    history: [],
    secrets: {},
};

function merge(base, extra) {
    const out = { ...base };
    for (const [key, value] of Object.entries(extra ?? {})) {
        if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
            out[key] = merge(base[key], value);
        } else {
            out[key] = value;
        }
    }
    return out;
}

export default class Store {
    constructor() {
        this.file = path.join(app.getPath('userData'), 'config.json');
        this.data = structuredClone(DEFAULTS);
        try {
            this.data = merge(DEFAULTS, JSON.parse(fs.readFileSync(this.file, 'utf-8')));
        } catch (err) {
            if (err.code !== 'ENOENT') console.error('[store] No se pudo leer la configuración', err);
        }
    }

    get(key) {
        return this.data[key];
    }

    set(patch) {
        this.data = merge(this.data, patch);
        this.save();
    }

    /** Configuración visible por la interfaz (sin secretos). */
    publicConfig() {
        const { secrets, lastSession, history, ...rest } = this.data;
        return { ...rest, loggedIn: !!secrets.sessionToken };
    }

    getSecret(name) {
        const value = this.data.secrets[name];
        if (!value) return null;
        try {
            const raw = Buffer.from(value, 'base64');
            return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf-8');
        } catch (err) {
            console.error('[store] No se pudo descifrar', name, err);
            return null;
        }
    }

    setSecret(name, value) {
        const secrets = { ...this.data.secrets };
        if (value == null) {
            delete secrets[name];
        } else {
            const raw = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value) : Buffer.from(value, 'utf-8');
            secrets[name] = raw.toString('base64');
        }
        this.data.secrets = secrets;
        this.save();
    }

    save() {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
        fs.renameSync(tmp, this.file);
    }
}
