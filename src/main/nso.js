import { addUserAgent, setClientAuthentication } from 'nxapi';
import CoralApi, { NintendoAccountSessionAuthorisationCoral } from 'nxapi/coral';

const APP_USER_AGENT = 'reactor-nsw2-rpc/1.0.0 (+https://github.com/enfermomental/reactor-nsw2-rpc)';
/** Tiempo mínimo entre inicios de sesión completos en Coral (nxapi pide no abusar de ellos). */
const MIN_LOGIN_GAP = 5 * 60 * 1000;

addUserAgent(APP_USER_AGENT);

export class LoginRequiredError extends Error {
    constructor(message = 'Inicia sesión con tu cuenta secundaria de Nintendo.') {
        super(message);
        this.code = 'LOGIN_REQUIRED';
    }
}

/** Traduce los errores de Nintendo / nxapi a mensajes entendibles. */
export function describeError(err) {
    if (!err) return 'Error desconocido';
    if (err.code === 'LOGIN_REQUIRED' || err.code === 'CLIENT_ID_REQUIRED') return err.message;

    const status = err.data?.status;
    const naError = err.data?.error;
    const message = String(err.message ?? err);

    if (naError === 'invalid_scope') return 'Tu cliente de nxapi-auth no tiene aprobados los permisos ca:gf ca:er ca:dr. Actívalos en nxapi-auth → OAuth clients → tu cliente → Scope, guarda y, si piden aprobación, solicítala en el canal #nxapi-auth de Discord.';
    if (naError === 'unauthorized_client') return 'Tu cliente de nxapi-auth no permite "client credentials". Actívalo en nxapi-auth → OAuth clients → tu cliente.';
    if (naError === 'invalid_grant') return 'La sesión de Nintendo caducó o fue revocada. Vuelve a iniciar sesión.';
    if (status === 9403 || status === 9406) return 'Nintendo rechazó el token. Vuelve a iniciar sesión.';
    if (status === 9407) return 'La cuenta secundaria no está vinculada a un usuario de consola.';
    if (status === 9427) return 'Nintendo exige una versión más nueva de la app. Actualiza el paquete nxapi.';
    if (status === 9437) return 'Nintendo limitó las peticiones (rate limit). Se reintentará más tarde.';
    if (status === 9450) return 'La cuenta secundaria necesita Nintendo Switch Online para esta función.';
    if (/Client authentication not configured/i.test(message)) return 'Falta el Client ID de nxapi-auth (Configuración → Conexión).';
    if (/Remote configuration prevents Coral/i.test(message)) return 'nxapi desactivó temporalmente la autenticación (configuración remota). Actualiza nxapi.';
    if (/znca-api/i.test(message)) return 'El servicio de nxapi-znca-api respondió con un error: ' + message.replace(/^\[znca-api\]\s*/, '');
    if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(message)) return 'Sin conexión con los servidores. Revisa tu internet.';
    return message;
}

export default class NsoService {
    constructor(store) {
        this.store = store;
        this.coral = null;
        this.authData = null;
        this.lastLoginAt = 0;
        this.loginPromise = null;
        this.configureClient();
    }

    configureClient() {
        const id = this.store.get('nxapiClientId')?.trim();
        if (id) setClientAuthentication({ id, scope: 'ca:gf ca:er ca:dr' });
        this.reset();
    }

    reset() {
        this.coral = null;
        this.authData = null;
    }

    get hasSession() {
        return !!this.store.getSecret('sessionToken');
    }

    createAuthorisation() {
        return NintendoAccountSessionAuthorisationCoral.create();
    }

    /** Recibe la URL npf71b963c1b7b6d119://auth#... y obtiene el session token. */
    async completeLogin(authorisation, redirectUrl) {
        const url = new URL(redirectUrl.trim());
        const params = new URLSearchParams(url.hash.replace(/^#/, '') || url.search.replace(/^\?/, ''));
        const result = await authorisation.getSessionToken(params);

        this.store.setSecret('sessionToken', result.session_token);
        this.store.setSecret('coralAuth', null);
        this.reset();
        this.lastLoginAt = 0;
        return this.ensureCoral();
    }

    logout() {
        this.store.setSecret('sessionToken', null);
        this.store.setSecret('coralAuth', null);
        this.store.set({ account: null, friendNsaId: '' });
        this.reset();
    }

    async ensureCoral() {
        if (this.coral) return this.coral;
        return this.loginPromise ??= this.login().finally(() => this.loginPromise = null);
    }

    async login() {
        const sessionToken = this.store.getSecret('sessionToken');
        if (!sessionToken) throw new LoginRequiredError();
        if (!this.store.get('nxapiClientId')?.trim()) {
            const err = new Error('Falta el Client ID de nxapi-auth (Configuración → Conexión).');
            err.code = 'CLIENT_ID_REQUIRED';
            throw err;
        }

        let data = null;
        try {
            const cached = JSON.parse(this.store.getSecret('coralAuth') ?? 'null');
            if (cached?.expires_at > Date.now() + 60_000) data = cached;
        } catch {}

        let coral;
        if (data) {
            coral = CoralApi.createWithSavedToken(data);
        } else {
            const wait = this.lastLoginAt + MIN_LOGIN_GAP - Date.now();
            if (wait > 0) throw new Error(`Esperando ${Math.ceil(wait / 1000)} s antes de volver a autenticar con Nintendo.`);
            this.lastLoginAt = Date.now();

            const result = await CoralApi.createWithSessionToken(sessionToken);
            coral = result.nso;
            data = { ...result.data, expires_at: Date.now() + result.data.credential.expiresIn * 1000 };
            this.saveAuth(data);
        }

        coral.onTokenExpired = async () => {
            const partial = await coral.renewToken(sessionToken, this.authData.user);
            const merged = {
                ...this.authData,
                ...partial,
                expires_at: Date.now() + partial.credential.expiresIn * 1000,
            };
            this.saveAuth(merged);
            return merged;
        };

        this.coral = coral;
        this.authData = data;
        return coral;
    }

    saveAuth(data) {
        this.authData = data;
        this.store.setSecret('coralAuth', JSON.stringify(data));
        const user = data.nsoAccount?.user;
        this.store.set({
            account: {
                name: user?.name ?? data.user?.nickname ?? 'Cuenta de Nintendo',
                nickname: data.user?.nickname ?? null,
                imageUri: user?.imageUri ?? data.user?.mii?.imageUriTemplate ?? null,
                country: data.user?.country ?? null,
            },
        });
    }

    async getFriends() {
        try {
            const coral = await this.ensureCoral();
            const result = await coral.getFriendList();
            return result.friends ?? [];
        } catch (err) {
            if (err.data?.error === 'invalid_grant' || [9403, 9406].includes(err.data?.status)) {
                // El session token ya no sirve: hay que volver a iniciar sesión.
                this.store.setSecret('coralAuth', null);
                this.reset();
            }
            throw err;
        }
    }
}
