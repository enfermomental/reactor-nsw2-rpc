const MAX_HISTORY = 14;

export const Platform = { NX: 1, OUNCE: 2 };

export function platformName(platform) {
    if (platform === Platform.OUNCE) return 'Nintendo Switch 2';
    if (platform === Platform.NX) return 'Nintendo Switch';
    return 'Nintendo Switch';
}

export function formatPlayTime(minutes) {
    if (!Number.isFinite(minutes) || minutes <= 0) return 'Menos de 1 h';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m} min`;
    return m ? `${h.toLocaleString('es')} h ${m} min` : `${h.toLocaleString('es')} h`;
}

export function formatDate(seconds) {
    if (!seconds) return null;
    return new Date(seconds * 1000).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

function gameKey(game) {
    return game.shopUri || game.name;
}

function clip(text, max = 128) {
    if (!text) return undefined;
    const value = String(text).trim();
    if (value.length < 2) return undefined;
    return value.length > max ? value.slice(0, max - 1) + '…' : value;
}

/**
 * Sigue la presencia del amigo elegido y calcula la sesión actual.
 *
 * Nintendo no expone cuándo empezó la sesión: si la app ve el cambio de juego,
 * usa presence.updatedAt (o el momento de la consulta); si la app arranca con
 * el juego ya abierto, el inicio es una estimación (updatedAt se refresca cada hora).
 */
export default class Tracker {
    constructor(store) {
        this.store = store;
        this.session = null;
        this.lastPollAt = null;
    }

    update(friend, now = Date.now(), pollInterval = 30) {
        const presence = friend?.presence;
        const game = presence && presence.game && 'name' in presence.game ? presence.game : null;
        const firstPoll = this.lastPollAt === null;
        const prevPollAt = this.lastPollAt;
        this.lastPollAt = now;

        if (!game) {
            this.endSession(now);
            return { status: presence?.state === 'INACTIVE' ? 'inactive' : 'offline', presence, game: null, session: null };
        }

        const key = gameKey(game);
        const updatedAt = (presence.updatedAt ?? 0) * 1000;

        if (!this.session || this.session.key !== key) {
            this.endSession(now);

            const saved = this.store.get('lastSession');
            const resumeWindow = pollInterval * 3000 + 60_000;
            if (saved && saved.key === key && now - saved.lastSeen < resumeWindow) {
                this.session = { ...saved };
            } else if (firstPoll || !prevPollAt) {
                this.session = { key, start: Math.min(updatedAt || now, now), estimated: true };
            } else {
                const start = updatedAt && updatedAt > prevPollAt - 5000 ? Math.min(updatedAt, now) : now;
                this.session = { key, start, estimated: false };
            }
            this.session.name = game.name;
            this.session.imageUri = game.imageUri;
        }

        this.session.lastSeen = now;
        this.session.totalPlayTime = game.totalPlayTime;
        this.store.set({ lastSession: this.session });

        return {
            status: 'playing',
            presence,
            game: {
                name: game.name,
                imageUri: game.imageUri,
                shopUri: game.shopUri || null,
                totalPlayTime: game.totalPlayTime ?? 0,
                totalPlayTimeText: formatPlayTime(game.totalPlayTime ?? 0),
                firstPlayedAt: game.firstPlayedAt || null,
                firstPlayedText: formatDate(game.firstPlayedAt),
                sysDescription: game.sysDescription?.trim() || null,
                platform: presence.platform ?? null,
                platformName: platformName(presence.platform),
                online: presence.state === 'PLAYING',
            },
            session: { start: this.session.start, estimated: this.session.estimated },
        };
    }

    endSession(now = Date.now()) {
        if (!this.session) return;
        const ended = this.session;
        this.session = null;
        this.store.set({ lastSession: null });
        this.addHistory({
            key: ended.key,
            name: ended.name,
            imageUri: ended.imageUri,
            totalPlayTime: ended.totalPlayTime ?? 0,
            lastSessionMinutes: Math.max(0, Math.round(((ended.lastSeen ?? now) - ended.start) / 60000)),
            lastPlayed: ended.lastSeen ?? now,
        });
    }

    addHistory(entry) {
        const history = (this.store.get('history') ?? []).filter(h => h.key !== entry.key);
        history.unshift(entry);
        this.store.set({ history: history.slice(0, MAX_HISTORY) });
    }

    /** Lista de recientes; incluye el juego actual primero (estilo menú HOME). */
    recent(current) {
        const history = this.store.get('history') ?? [];
        if (!current) return history;
        const key = gameKey(current);
        return [
            { key, name: current.name, imageUri: current.imageUri, totalPlayTime: current.totalPlayTime, current: true },
            ...history.filter(h => h.key !== key),
        ].slice(0, MAX_HISTORY);
    }
}

/** Construye la actividad de Discord a partir del estado actual. */
export function buildActivity(view, friend, settings) {
    const p = settings.presence;

    if (view.status === 'inactive' && p.showWhenInactive) {
        return {
            type: 0,
            details: 'Menú HOME',
            state: 'Consola encendida, sin programa abierto',
            largeImageKey: 'nsw2',
            largeImageText: platformName(Platform.OUNCE),
        };
    }
    if (view.status !== 'playing' || !view.game) return null;

    const g = view.game;
    const stateParts = [];
    if (p.showDescription && g.sysDescription) stateParts.push(g.sysDescription);
    if (p.showTotal) stateParts.push(`${g.totalPlayTimeText} en total`);
    if (!stateParts.length) stateParts.push(g.online ? 'Jugando en línea' : `En ${g.platformName}`);

    const largeTextParts = [g.name];
    if (p.showFirstPlayed && g.firstPlayedText) largeTextParts.push(`Desde ${g.firstPlayedText}`);
    if (p.showTotal) largeTextParts.push(g.totalPlayTimeText);

    const smallText = [g.platformName, g.online ? 'Jugando en línea' : null, friend?.name].filter(Boolean).join(' · ');

    const activity = {
        type: 0,
        details: clip(g.name),
        state: clip(stateParts.join(' · ')),
        largeImageKey: /^https:\/\//.test(g.imageUri ?? '') ? g.imageUri : 'nsw2',
        largeImageText: clip(largeTextParts.join(' · ')),
        statusDisplayType: p.statusDisplay === 'details' ? 2 : 0,
    };

    if (p.showElapsed && view.session?.start) activity.startTimestamp = view.session.start;

    if (p.smallImage === 'avatar' && /^https:\/\//.test(friend?.imageUri ?? '')) {
        activity.smallImageKey = friend.imageUri;
        activity.smallImageText = clip(smallText);
    } else if (p.smallImage === 'platform') {
        activity.smallImageKey = g.platform === Platform.NX ? 'nsw1' : 'nsw2';
        activity.smallImageText = clip(smallText);
    }

    if (g.shopUri && /^https:\/\//.test(g.shopUri)) {
        activity.detailsUrl = g.shopUri;
        activity.largeImageUrl = g.shopUri;
        if (p.showShopButton) activity.buttons = [{ label: 'Ver en Nintendo eShop', url: g.shopUri }];
    }

    return activity;
}
