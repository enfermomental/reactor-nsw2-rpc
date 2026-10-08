import { EventEmitter } from 'node:events';
import { Client } from '@xhayper/discord-rpc';

const RECONNECT_DELAY = 15_000;
/** Discord permite ~5 actualizaciones cada 20 s; dejamos margen. */
const MIN_UPDATE_GAP = 5_000;

export default class DiscordPresence extends EventEmitter {
    constructor() {
        super();
        this.clientId = null;
        this.client = null;
        this.connected = false;
        this.user = null;
        this.error = null;
        this.desired = null;
        this.sent = undefined;
        this.lastSentAt = 0;
        this.flushTimer = null;
        this.reconnectTimer = null;
        this.appName = null;
    }

    get status() {
        return {
            connected: this.connected,
            user: this.user,
            error: this.error,
            configured: !!this.clientId,
            appName: this.appName,
        };
    }

    setClientId(clientId) {
        clientId = clientId?.trim() || null;
        if (clientId === this.clientId) return;
        this.clientId = clientId;
        this.appName = null;
        this.error = null;
        this.disconnect();
        if (clientId) {
            this.connect();
            this.fetchAppName(clientId);
        }
    }

    /** Nombre público de la aplicación (lo que Discord muestra como "Jugando a …"). */
    async fetchAppName(clientId) {
        try {
            const res = await fetch(`https://discord.com/api/v10/applications/${clientId}/rpc`);
            if (!res.ok) return;
            const data = await res.json();
            if (this.clientId === clientId && data?.name) {
                this.appName = data.name;
                this.emit('change');
            }
        } catch {}
    }

    async connect() {
        clearTimeout(this.reconnectTimer);
        if (!this.clientId || this.client) return;

        const client = new Client({ clientId: this.clientId, transport: { type: 'ipc' } });
        this.client = client;

        client.on('ready', () => {
            this.connected = true;
            this.error = null;
            this.user = client.user ? { username: client.user.username, globalName: client.user.globalName ?? client.user.global_name ?? null } : null;
            this.sent = undefined;
            this.emit('change');
            this.flush();
        });
        client.on('disconnected', () => this.handleClose(client));

        try {
            await client.login();
        } catch (err) {
            const message = String(err?.message ?? err);
            this.error = /Could not connect|ENOENT/i.test(message) ? 'Discord no está abierto'
                : /Connection ended/i.test(message) ? 'Discord rechazó la conexión (¿Application ID correcto?)'
                : message;
            this.handleClose(client);
        }
    }

    handleClose(client) {
        if (this.client !== client) return;
        this.client = null;
        this.connected = false;
        this.user = null;
        client.destroy().catch(() => {});
        this.emit('change');
        clearTimeout(this.reconnectTimer);
        if (this.clientId) this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY);
    }

    disconnect() {
        clearTimeout(this.reconnectTimer);
        clearTimeout(this.flushTimer);
        const client = this.client;
        this.client = null;
        this.connected = false;
        this.user = null;
        this.sent = undefined;
        if (client) client.user?.clearActivity().catch(() => {}).finally(() => client.destroy().catch(() => {}));
        this.emit('change');
    }

    setActivity(activity) {
        this.desired = activity ?? null;
        this.flush();
    }

    flush() {
        clearTimeout(this.flushTimer);
        if (!this.connected || !this.client?.user) return;

        const payload = JSON.stringify(this.desired);
        if (payload === this.sent) return;

        const wait = this.lastSentAt + MIN_UPDATE_GAP - Date.now();
        if (wait > 0) {
            this.flushTimer = setTimeout(() => this.flush(), wait);
            return;
        }

        this.lastSentAt = Date.now();
        this.sent = payload;
        const request = this.desired ? this.client.user.setActivity(this.desired) : this.client.user.clearActivity();
        request.then(() => {
            if (this.error) {
                this.error = null;
                this.emit('change');
            }
        }, err => {
            this.sent = undefined;
            this.error = 'Discord rechazó la actividad: ' + (err?.message ?? err);
            this.emit('change');
        });
    }
}
