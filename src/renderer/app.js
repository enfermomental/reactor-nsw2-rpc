const api = window.nsw2;
const $ = id => document.getElementById(id);

let S = null;
let view = 'home';
let section = 'start';
let hoverCaption = null;
let loginBusy = false;
let loginError = null;
let toastTimer = null;
let lastToast = null;

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (id, cls = '') => `<svg class="ico ${cls}"><use href="#i-${id}"/></svg>`;
const isUrl = value => typeof value === 'string' && /^(https:\/\/|data:image\/)/.test(value);
const img = (src, cls = '') => isUrl(src) ? `<img class="${cls}" src="${esc(src)}" alt="" referrerpolicy="no-referrer" draggable="false">` : '';

/* ── Formato ───────────────────────────────────────── */
function fmtDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor(total / 60) % 60;
    const s = total % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtAgo(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return `hace ${s} s`;
    const m = Math.round(s / 60);
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    if (h < 48) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} días`;
}

function fmtSince(seconds) {
    if (!seconds) return '';
    const from = new Date(seconds * 1000);
    const now = new Date();
    let months = (now.getFullYear() - from.getFullYear()) * 12 + now.getMonth() - from.getMonth();
    if (now.getDate() < from.getDate()) months--;
    if (months < 1) {
        const days = Math.max(0, Math.floor((now - from) / 86400000));
        return days === 0 ? 'Hoy' : days === 1 ? 'Hace 1 día' : `Hace ${days} días`;
    }
    const years = Math.floor(months / 12);
    const rest = months % 12;
    const parts = [];
    if (years) parts.push(years === 1 ? '1 año' : `${years} años`);
    if (rest) parts.push(rest === 1 ? '1 mes' : `${rest} meses`);
    return 'Hace ' + parts.join(' y ');
}

const fmtTime = ms => new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
const shortHours = minutes => minutes >= 60 ? `${Math.floor(minutes / 60)} h` : `${minutes || 0} min`;

/* ── Tema ──────────────────────────────────────────── */
function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
}

/* ── Barra superior ────────────────────────────────── */
function presenceLabel() {
    switch (S.status) {
        case 'playing': return S.game?.online ? 'Jugando en línea' : 'Jugando ahora';
        case 'inactive': return 'En línea · menú HOME';
        case 'offline': return 'Desconectado';
        case 'setup': return 'Sin configurar';
        case 'no-friend': return 'Elige un usuario';
        case 'friend-missing': return 'No encontrado';
        default: return 'Conectando…';
    }
}

function renderTop() {
    const friend = S.friend;
    const ring = S.status === 'playing' ? 'playing' : S.status === 'inactive' ? 'on' : '';
    const avatar = friend?.imageUri ?? S.config.account?.imageUri;
    $('topUser').innerHTML = `
        ${isUrl(avatar) ? img(avatar, `avatar ${ring}`) : `<span class="avatar ${ring}"></span>`}
        <div class="user-text">
            <span class="user-name">${esc(friend?.name ?? 'NSW2 Presence')}</span>
            <span class="user-sub">${esc(presenceLabel())}</span>
        </div>`;

    const d = S.discord;
    const pill = $('discordPill');
    pill.className = 'pill' + (d.connected ? ' ok' : d.configured ? ' warn' : '');
    const text = !d.configured ? 'Discord sin configurar'
        : !d.connected ? (d.error ?? 'Buscando Discord…')
        : S.activity ? 'Mostrando en Discord' : 'Discord conectado';
    pill.innerHTML = `<span class="dot"></span>${esc(text)}`;
    pill.title = d.user ? `Conectado como ${d.user.globalName ?? d.user.username}` : 'Discord';

    $('wifiIcon').classList.toggle('off', !!S.error);
}

/* ── HOME ──────────────────────────────────────────── */
function placeholderCover(selected = false) {
    return `<div class="cover ${selected ? 'selected' : ''}"><div class="placeholder"><svg><use href="#i-console"/></svg></div></div>`;
}

function stat(label, iconId, value, sub, opts = {}) {
    return `<div class="stat ${opts.accent ? 'accent' : ''}">
        <div class="stat-label">${icon(iconId)}${esc(label)}</div>
        <div class="stat-value" ${opts.id ? `id="${opts.id}"` : ''}>${esc(value)}</div>
        <div class="stat-sub" ${opts.subId ? `id="${opts.subId}"` : ''}>${esc(sub ?? '')}</div>
    </div>`;
}

function renderHero() {
    const hero = $('hero');
    const name = S.friend?.name ?? 'tu cuenta';

    if (S.status === 'setup') {
        hero.innerHTML = `<div class="setup">${placeholderCover(true)}<div class="info">
            <h1 class="title">Bienvenido a NSW2 Presence</h1>
            <p class="lead">Completa estos pasos para mostrar en Discord lo que juegas en tu Nintendo Switch 2.</p>
            <div class="steps">${setupSteps()}</div>
        </div></div>`;
        return;
    }

    if (S.status === 'playing' && S.game) {
        const g = S.game;
        const short = g.platform === 1 ? 'Switch' : 'Switch 2';
        const trail = g.sysDescription
            ? `<div class="trail">${icon('trail')}<div><div class="trail-label">Rastro de juego</div><div class="trail-text">${esc(g.sysDescription)}</div></div></div>`
            : `<div class="trail empty">${icon('trail')}<div class="trail-text">Este juego no está compartiendo detalles adicionales ahora mismo.</div></div>`;
        const sessionSub = S.session ? `Desde las ${fmtTime(S.session.start)}${S.session.estimated ? ' · aprox.' : ''}` : '';
        hero.innerHTML = `
            <div class="cover selected">${img(g.imageUri)}<span class="cover-badge"><svg><use href="#i-console"/></svg>${esc(short)}</span></div>
            <div class="info">
                <div class="eyebrow">
                    <span class="chip platform"><svg><use href="#i-console"/></svg>${esc(g.platformName)}</span>
                    <span class="chip ${g.online ? 'online-play' : 'live'}"><span class="dot"></span>${g.online ? 'Jugando en línea' : 'Jugando ahora'}</span>
                </div>
                <h1 class="title">${esc(g.name)}</h1>
                ${trail}
                <div class="stats">
                    ${stat('Sesión actual', 'clock', S.session ? fmtDuration(Date.now() - S.session.start) : '—', sessionSub, { id: 'sessionTimer', accent: true })}
                    ${stat('Tiempo total', 'hourglass', g.totalPlayTimeText, 'Registrado por Nintendo')}
                    ${stat('Primera vez', 'calendar', g.firstPlayedText ?? '—', fmtSince(g.firstPlayedAt))}
                </div>
            </div>`;
        return;
    }

    const msg = {
        inactive: ['En el menú HOME', `La consola de ${name} está encendida, pero no hay ningún programa abierto.`],
        offline: ['Sin conexión', `La consola de ${name} está apagada, en modo reposo o sin conexión a internet.`],
        'no-friend': ['Elige a quién mostrar', 'La cuenta secundaria ya está conectada. Elige tu cuenta principal en la lista de amigos.'],
        'friend-missing': ['No se encontró al usuario', 'La cuenta elegida ya no aparece en la lista de amigos de la cuenta secundaria.'],
        error: ['No se pudo conectar', S.error ?? 'Ocurrió un error al consultar a Nintendo.'],
        loading: ['Conectando…', 'Consultando la presencia en los servidores de Nintendo.'],
    }[S.status] ?? ['Conectando…', ''];

    let extra = '';
    if (S.status === 'inactive' || S.status === 'offline') {
        const last = S.status === 'offline' && S.logoutAt ? fmtAgo(S.logoutAt * 1000) : S.presenceUpdatedAt ? fmtAgo(S.presenceUpdatedAt * 1000) : '—';
        const lastGame = S.recent?.[0];
        extra = `<div class="stats">
            ${stat(S.status === 'offline' ? 'Última conexión' : 'Estado actualizado', 'clock', last, S.status === 'offline' ? 'Según Nintendo' : 'Presencia del servidor')}
            ${stat('Último juego', 'trail', lastGame?.name ?? '—', lastGame ? `${shortHours(lastGame.totalPlayTime)} en total` : '')}
            ${stat('Discord', 'discord', S.activity ? 'Visible' : 'Oculto', S.activity ? 'Mostrando menú HOME' : 'Sin actividad publicada')}
        </div>`;
    } else if (S.status === 'no-friend' || S.status === 'friend-missing') {
        extra = `<div class="inline"><button class="btn primary" data-action="open-settings" data-section="friend">Elegir usuario</button></div>`;
    } else if (S.status === 'error') {
        extra = `<div class="inline"><button class="btn primary" data-action="refresh">${icon('refresh')}Reintentar</button><button class="btn" data-action="open-settings" data-section="connection">Revisar configuración</button></div>`;
    }

    hero.innerHTML = `${placeholderCover(S.status === 'inactive')}<div class="info">
        ${S.status === 'inactive' ? '<div class="eyebrow"><span class="chip live"><span class="dot"></span>En línea</span></div>' : ''}
        <h1 class="title">${esc(msg[0])}</h1>
        <p class="lead">${esc(msg[1])}</p>
        ${extra}
    </div>`;
}

function setupSteps() {
    const s = S.setup;
    const steps = [
        ['consent', 'Acepta el aviso de privacidad', 'Explica qué datos se envían a servicios externos.', 'start'],
        ['clientId', 'Registra un Client ID de nxapi', 'Necesario para generar el token "f" de Nintendo.', 'connection'],
        ['login', 'Inicia sesión con tu cuenta secundaria', 'Una cuenta de Nintendo que sea amiga de tu cuenta principal.', 'account'],
        ['friend', 'Elige tu cuenta principal', 'La que usas en tu Nintendo Switch 2.', 'friend'],
        ['discord', 'Conecta tu aplicación de Discord', 'Application ID del Discord Developer Portal.', 'discord'],
    ];
    return steps.map(([key, title, desc, target], i) => `
        <div class="step ${s[key] ? 'done' : ''}">
            <span class="step-num">${s[key] ? icon('check') : i + 1}</span>
            <div><div class="step-title">${esc(title)}</div><div class="step-desc">${esc(desc)}</div></div>
            <button class="btn small ${!s[key] && firstPending() === key ? 'primary' : ''}" data-action="open-settings" data-section="${target}">${s[key] ? 'Revisar' : 'Configurar'}</button>
        </div>`).join('');
}

function firstPending() {
    return ['consent', 'clientId', 'login', 'friend', 'discord'].find(k => !S.setup[k]);
}

function renderShelf() {
    const items = S.recent ?? [];
    const row = $('shelf');
    const tiles = items.map((g, i) => `
        <div class="tile ${g.current ? 'selected' : ''}" data-caption="${esc(g.name)}" title="${esc(g.name)}">
            ${img(g.imageUri)}
            ${g.totalPlayTime ? `<span class="tile-time">${esc(shortHours(g.totalPlayTime))}</span>` : ''}
        </div>`);
    while (tiles.length < 8) tiles.push('<div class="tile empty"></div>');
    row.innerHTML = tiles.join('');
    $('shelfCaption').textContent = hoverCaption ?? (items[0]?.current ? items[0].name : '');
}

function renderDiscordPreview() {
    const card = $('discordPreview');
    const c = S.config;
    const a = S.activity;
    const live = a && c.discordClientId && c.rpcEnabled;
    const head = `<div class="dc-head"><span>${live ? 'Jugando a un juego' : 'Discord'}</span><span>Vista previa</span></div>`;

    if (!c.discordClientId) {
        card.innerHTML = head + `<div class="dc-empty">Añade el Application ID de Discord para publicar tu actividad. <a class="link" data-action="open-settings" data-section="discord">Configurar</a></div>`;
        return;
    }
    if (!c.rpcEnabled) {
        card.innerHTML = head + '<div class="dc-empty">El Rich Presence está desactivado en la configuración.</div>';
        return;
    }
    if (!a) {
        card.innerHTML = head + '<div class="dc-empty">Sin actividad publicada. Aparecerá aquí en cuanto abras un juego en tu consola.</div>';
        return;
    }

    const art = isUrl(a.largeImageKey) ? a.largeImageKey : S.game?.imageUri;
    const big = isUrl(art) ? img(art, 'big') : `<div class="big glyph"><svg><use href="#i-console"/></svg></div>`;
    const small = isUrl(a.smallImageKey) ? img(a.smallImageKey, 'small')
        : a.smallImageKey ? `<span class="small glyph"><svg><use href="#i-console"/></svg></span>` : '';
    const appName = S.discord.appName ?? 'Tu app de Discord';
    const listName = c.presence.statusDisplay === 'details' ? a.details : appName;
    card.innerHTML = head + `
        <div class="dc-body">
            <div class="dc-art">${big}${small}</div>
            <div class="dc-lines">
                <div class="dc-app">${esc(appName)}</div>
                ${a.details ? `<div>${esc(a.details)}</div>` : ''}
                ${a.state ? `<div class="dc-sub">${esc(a.state)}</div>` : ''}
                ${a.startTimestamp ? `<div class="dc-elapsed" id="dcElapsed">${fmtDuration(Date.now() - a.startTimestamp)} transcurrido</div>` : ''}
            </div>
        </div>
        ${a.buttons?.length ? `<div class="dc-btns">${a.buttons.map(b => `<div class="dc-btn">${esc(b.label)}</div>`).join('')}</div>` : ''}
        <div class="dc-foot">Lista de miembros: <b>Jugando a ${esc(listName ?? '')}</b></div>`;
}

/* ── Configuración ─────────────────────────────────── */
const SECTIONS = [
    { id: 'start', label: 'Primeros pasos', done: s => s.consent },
    { id: 'connection', label: 'Conexión (nxapi)', done: s => s.clientId },
    { id: 'account', label: 'Cuenta secundaria', done: s => s.login },
    { id: 'friend', label: 'Usuario a mostrar', done: s => s.friend },
    { id: 'discord', label: 'Discord', done: s => s.discord },
    { id: 'presence', label: 'Qué se muestra' },
    { id: 'theme', label: 'Tema' },
    { id: 'system', label: 'Segundo plano' },
    { id: 'about', label: 'Acerca de' },
];

function renderSettingsNav() {
    $('settingsNav').innerHTML = `<div class="snav-title">${icon('gear')}Configuración</div>` + SECTIONS.map(sec => {
        const mark = sec.done ? (sec.done(S.setup) ? icon('check', 'ok') : '<span class="need"></span>') : '';
        return `<button class="${sec.id === section ? 'active' : ''}" data-action="section" data-section="${sec.id}">${esc(sec.label)}${mark}</button>`;
    }).join('');
}

function toggle(path, checked) {
    return `<label class="toggle"><input type="checkbox" data-config="${path}" ${checked ? 'checked' : ''}><span></span></label>`;
}

function row(label, help, control) {
    return `<div class="row"><div class="row-main"><div class="row-label">${label}</div>${help ? `<div class="row-help">${help}</div>` : ''}</div>${control}</div>`;
}

function friendStatus(f) {
    if (f.state === 'ONLINE' || f.state === 'PLAYING') {
        const platform = f.platform === 2 ? 'Switch 2' : f.platform === 1 ? 'Switch' : '';
        return { cls: 'playing', text: `${f.state === 'PLAYING' ? 'Jugando en línea a ' : 'Jugando a '}${f.gameName ?? 'un juego'}${platform ? ' · ' + platform : ''}` };
    }
    if (f.state === 'INACTIVE') return { cls: 'on', text: 'En línea' };
    return { cls: '', text: 'Desconectado o estado oculto' };
}

const SECTION_RENDER = {
    start: () => `
        <h2>Primeros pasos</h2>
        <p class="desc">Nintendo no permite que una cuenta lea su propia actividad. Por eso esta app inicia sesión con una <b>cuenta secundaria</b> que es tu amiga y lee tu estado tal como lo vería la app Nintendo Switch App en un teléfono.</p>
        <div class="group"><div class="group-title">Lo que necesitas</div>
            <div class="notice"><ol>
                <li>Una segunda cuenta de Nintendo (gratuita) vinculada a un usuario en cualquier consola Switch o Switch 2, y agregada como <b>amiga</b> de tu cuenta principal.</li>
                <li>En tu Switch 2: <b>Configuración del usuario → Configuración de amigos → Mostrar estado en línea a</b> "Amigos" (o "Mejores amigos" y marca la secundaria como mejor amiga).</li>
                <li>Discord de escritorio abierto en este PC.</li>
            </ol></div>
        </div>
        <div class="group"><div class="group-title">Aviso de privacidad</div>
            <div class="notice warn">Para iniciar sesión en la API de Nintendo hace falta un parámetro <code>f</code> que solo puede generar la app oficial. Esta app usa el servicio externo <b>nxapi-znca-api</b> (de Samuel Elliott, autor de nxapi): se le envía un token de identificación de la <b>cuenta secundaria</b> (incluye su ID de Nintendo Account y de Nintendo Switch Online) y también cifra/descifra las peticiones a Nintendo. Tus contraseñas nunca salen de la ventana oficial de Nintendo. <a data-action="external" data-url="https://github.com/samuelthomas2774/nxapi#coral-client-authentication">Más información</a></div>
            <div class="rows">${row('Entiendo y acepto el uso de nxapi-znca-api', 'Sin esto la app no se conectará a Nintendo.', toggle('consentAccepted', S.config.consentAccepted))}</div>
        </div>`,

    connection: () => `
        <h2>Conexión (nxapi)</h2>
        <p class="desc">El servicio que genera el token <code>f</code> exige que cada app se registre. Es gratis y solo hay que hacerlo una vez.</p>
        <div class="notice"><ol>
            <li>Abre <a data-action="external" data-url="https://nxapi-auth.fancy.org.uk/oauth/clients">nxapi-auth → OAuth clients</a> e inicia sesión.</li>
            <li>Crea un cliente nuevo de tipo <b>público</b> (por ejemplo "NSW2 Presence") y completa la información del cliente.</li>
            <li>En la sección <b>Scope</b> del cliente, dentro de <b>nxapi-znca-api</b>, marca <b>f-generation</b>, <b>Request encryption</b> y <b>Response decryption</b>, y pulsa <b>Save</b> en esa sección.</li>
            <li>Copia el <b>Client ID</b> y pégalo aquí abajo.</li>
        </ol></div>
        <div class="group"><div class="rows">
            ${row('Client ID de nxapi-auth', 'Se usan los permisos <code>ca:gf ca:er ca:dr</code>.', `<div class="inline"><input class="input" id="nxapiClientId" placeholder="Pega tu Client ID" value="${esc(S.config.nxapiClientId)}" spellcheck="false"><button class="btn small primary" data-action="save-field" data-field="nxapiClientId">Guardar</button></div>`)}
            ${row('Frecuencia de consulta', 'Cada cuánto se pregunta a Nintendo por tu estado. Valores bajos no hacen que Nintendo actualice antes.', `<select class="input" data-config="pollInterval">${[20, 30, 45, 60, 90, 120].map(v => `<option value="${v}" ${Number(S.config.pollInterval) === v ? 'selected' : ''}>Cada ${v} segundos</option>`).join('')}</select>`)}
        </div></div>`,

    account: () => {
        const acc = S.config.account;
        const blocked = !S.setup.consent || !S.setup.clientId;
        return `
        <h2>Cuenta secundaria</h2>
        <p class="desc">Inicia sesión con la cuenta <b>secundaria</b>, no con la principal. Se abrirá la página oficial de Nintendo; al final pulsa <b>"Elegir a esta persona"</b>.</p>
        ${blocked ? '<div class="notice warn">Primero acepta el aviso de privacidad y guarda tu Client ID de nxapi.</div>' : ''}
        ${S.config.loggedIn ? `
            <div class="account-card">
                ${isUrl(acc?.imageUri) ? img(acc.imageUri, 'avatar on') : '<span class="avatar on"></span>'}
                <div class="grow"><div class="row-label">${esc(acc?.name ?? 'Sesión iniciada')}</div><div class="row-help">${esc(acc?.nickname ? 'Nintendo Account: ' + acc.nickname : 'Datos de la cuenta pendientes')}</div></div>
                <button class="btn small danger" data-action="logout">Cerrar sesión</button>
            </div>` : `
            <div class="account-card">
                <span class="avatar"></span>
                <div class="grow"><div class="row-label">Sin sesión</div><div class="row-help">El token se guarda cifrado con la protección de datos de Windows.</div></div>
                <button class="btn primary" data-action="login" ${blocked || loginBusy ? 'disabled' : ''}>${loginBusy ? 'Esperando a Nintendo…' : 'Iniciar sesión'}</button>
            </div>
            <div class="group"><div class="group-title">¿La ventana no se cerró sola?</div>
                <div class="rows">${row('Pega el enlace de "Elegir a esta persona"', 'Haz clic derecho sobre el botón, copia la dirección del enlace (empieza por <code>npf71b963c1b7b6d119://</code>) y pégala aquí.', `<div class="inline"><input class="input" id="loginUrl" placeholder="npf71b963c1b7b6d119://auth#…" spellcheck="false"><button class="btn small" data-action="login-url">Usar</button></div>`)}</div>
            </div>`}
        ${loginError ? `<div class="error-text">${esc(loginError)}</div>` : ''}`;
    },

    friend: () => {
        if (!S.config.loggedIn) return `<h2>Usuario a mostrar</h2><p class="desc">Inicia sesión con la cuenta secundaria para ver su lista de amigos.</p><button class="btn primary" data-action="section" data-section="account">Ir a Cuenta secundaria</button>`;
        const friends = [...(S.friends ?? [])].sort((a, b) => (b.isFavoriteFriend - a.isFavoriteFriend) || a.name.localeCompare(b.name));
        return `
        <h2>Usuario a mostrar</h2>
        <p class="desc">Elige tu <b>cuenta principal</b> (la de tu Switch 2). Si no aparece, confirma que sois amigos y vuelve a actualizar.</p>
        <div class="inline mb"><button class="btn small" data-action="refresh">${icon('refresh', S.loading ? 'spin' : '')}Actualizar lista</button></div>
        ${friends.length ? `<div class="friends">${friends.map(f => {
            const st = friendStatus(f);
            return `<button class="friend ${f.nsaId === S.config.friendNsaId ? 'selected' : ''}" data-action="pick-friend" data-id="${esc(f.nsaId)}">
                ${isUrl(f.imageUri) ? img(f.imageUri, `avatar ${st.cls}`) : '<span class="avatar"></span>'}
                <div><div class="friend-name">${esc(f.name)}${f.isFavoriteFriend ? ' ★' : ''}</div><div class="friend-status ${st.cls}">${esc(st.text)}</div></div>
            </button>`;
        }).join('')}</div>` : `<div class="notice">${S.loading ? 'Cargando amigos…' : 'La cuenta secundaria todavía no tiene amigos, o aún no se ha podido consultar la lista.'}</div>`}`;
    },

    discord: () => {
        const d = S.discord;
        const status = !d.configured ? 'Sin configurar' : d.connected ? `Conectado${d.user ? ' como ' + (d.user.globalName ?? d.user.username) : ''}` : (d.error ?? 'Buscando Discord…');
        return `
        <h2>Discord</h2>
        <p class="desc">Discord muestra el nombre de tu aplicación como "Jugando a …". Crea una con el nombre que quieras ver (por ejemplo <b>Nintendo Switch 2</b>).</p>
        <div class="notice"><ol>
            <li>Abre el <a data-action="external" data-url="https://discord.com/developers/applications">Discord Developer Portal</a> → <b>New Application</b>.</li>
            <li>Copia el <b>Application ID</b> y pégalo aquí.</li>
            <li>Opcional: en <b>Rich Presence → Art Assets</b> sube <code>nsw2.png</code> con el nombre <code>nsw2</code> y <code>nsw1.png</code> como <code>nsw1</code> (icono de plataforma y menú HOME). <a data-action="open-assets">Abrir la carpeta de imágenes</a></li>
        </ol></div>
        <div class="group"><div class="rows">
            ${row('Application ID', '', `<div class="inline"><input class="input" id="discordClientId" placeholder="123456789012345678" value="${esc(S.config.discordClientId)}" spellcheck="false"><button class="btn small primary" data-action="save-field" data-field="discordClientId">Guardar</button></div>`)}
            ${row('Mostrar Rich Presence', 'Publica tu actividad en tu perfil de Discord.', toggle('rpcEnabled', S.config.rpcEnabled))}
            ${row('Estado', '', `<span class="row-value">${esc(status)}</span>`)}
        </div></div>`;
    },

    presence: () => {
        const p = S.config.presence;
        return `
        <h2>Qué se muestra</h2>
        <p class="desc">Elige qué detalles de tu partida aparecen en Discord. La vista previa del menú principal se actualiza al instante.</p>
        <div class="group"><div class="group-title">Información</div><div class="rows">
            ${row('Rastro de juego', 'Texto adicional que algunos juegos comparten (modo, mundo, actividad…).', toggle('presence.showDescription', p.showDescription))}
            ${row('Horas totales', 'Tiempo total jugado registrado por Nintendo.', toggle('presence.showTotal', p.showTotal))}
            ${row('Tiempo de la sesión actual', 'Contador "transcurrido" de Discord.', toggle('presence.showElapsed', p.showElapsed))}
            ${row('Fecha de la primera vez', 'Aparece al pasar el cursor por la carátula.', toggle('presence.showFirstPlayed', p.showFirstPlayed))}
            ${row('Botón "Ver en Nintendo eShop"', 'Los demás pueden abrir la ficha del juego.', toggle('presence.showShopButton', p.showShopButton))}
            ${row('Mostrar el menú HOME', 'Publica una actividad cuando la consola está encendida sin juego abierto (requiere el asset <code>nsw2</code>).', toggle('presence.showWhenInactive', p.showWhenInactive))}
        </div></div>
        <div class="group"><div class="group-title">Apariencia</div><div class="rows">
            ${row('Icono pequeño', 'Se muestra sobre la esquina de la carátula.', `<select class="input" data-config="presence.smallImage">
                <option value="avatar" ${p.smallImage === 'avatar' ? 'selected' : ''}>Mi icono de usuario</option>
                <option value="platform" ${p.smallImage === 'platform' ? 'selected' : ''}>Icono de la consola</option>
                <option value="none" ${p.smallImage === 'none' ? 'selected' : ''}>Ninguno</option></select>`)}
            ${row('Texto en la lista de miembros', '"Jugando a <título del juego>" en lugar del nombre de tu app de Discord.', `<select class="input" data-config="presence.statusDisplay">
                <option value="details" ${p.statusDisplay === 'details' ? 'selected' : ''}>Título del juego</option>
                <option value="name" ${p.statusDisplay === 'name' ? 'selected' : ''}>Nombre de la app</option></select>`)}
        </div></div>`;
    },

    theme: () => `
        <h2>Tema</h2>
        <p class="desc">Igual que en la consola: básico blanco o básico negro.</p>
        <div class="themes">
            ${[['system', 'Según Windows'], ['light', 'Básico blanco'], ['dark', 'Básico negro']].map(([id, label]) =>
                `<button class="theme-card ${id} ${S.config.theme === id ? 'selected' : ''}" data-action="theme" data-theme="${id}"><div class="preview"><i></i></div>${label}</button>`).join('')}
        </div>`,

    system: () => `
        <h2>Segundo plano</h2>
        <p class="desc">La actividad solo se publica en Discord mientras la app está abierta. Desde el icono de la bandeja de Windows puedes abrirla o salir por completo.</p>
        <div class="group"><div class="rows">
            ${row('Seguir en segundo plano al cerrar', 'Al cerrar la ventana, la app se queda en la bandeja y sigue actualizando Discord.', toggle('closeToTray', S.config.closeToTray))}
            ${row('Iniciar con Windows', S.canOpenAtLogin ? 'Se abre oculta en la bandeja al iniciar sesión en Windows.' : 'Solo disponible en la versión instalada (.exe).', S.canOpenAtLogin ? toggle('openAtLogin', S.config.openAtLogin) : '')}
        </div></div>`,

    about: () => `
        <h2>Acerca de</h2>
        <div class="group"><div class="rows">
            ${row('NSW2 Presence', 'Versión 1.0.0 · Rich Presence de Discord para Nintendo Switch 2.', '')}
            ${row('nxapi', 'Autenticación y API de Nintendo Switch App por Samuel Elliott (AGPL-3.0).', `<button class="btn small" data-action="external" data-url="https://github.com/samuelthomas2774/nxapi">${icon('link')}GitHub</button>`)}
            ${row('Datos locales', 'La configuración y los tokens cifrados se guardan en <code>%APPDATA%\\NSW2 Presence</code>.', '')}
            ${row('Aviso', 'Proyecto no oficial. No está afiliado ni respaldado por Nintendo ni por Discord.', '')}
        </div></div>`,
};

function renderSettingsPanel(force = false) {
    const panel = $('settingsPanel');
    if (!force && panel.contains(document.activeElement) && document.activeElement.matches('input.input, select')) return;
    const scroll = panel.scrollTop;
    panel.innerHTML = SECTION_RENDER[section]();
    panel.scrollTop = force ? 0 : scroll;
}

/* ── Pie ───────────────────────────────────────────── */
function renderFooter() {
    let text;
    if (S.status === 'setup') text = 'Completa la configuración para empezar';
    else if (S.loading) text = 'Consultando a Nintendo…';
    else if (S.lastUpdate) {
        const next = S.nextPollAt ? Math.max(0, Math.round((S.nextPollAt - Date.now()) / 1000)) : null;
        text = `Actualizado ${fmtAgo(S.lastUpdate)}${next !== null ? ` · siguiente consulta en ${next} s` : ''}`;
    } else text = 'Iniciando…';
    $('footStatus').textContent = text;
}

function renderHints() {
    $('footHints').innerHTML = view === 'home'
        ? `<button class="hint" data-action="refresh"><kbd>R</kbd>Actualizar</button><button class="hint" data-action="open-settings"><kbd>+</kbd>Configuración</button>`
        : `<button class="hint" data-action="back"><kbd>B</kbd>Atrás</button>`;
}

/* ── Toast ─────────────────────────────────────────── */
function toast(message, type = '') {
    const el = $('toast');
    el.className = 'toast ' + type;
    el.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 6000);
}

/* ── Render principal ──────────────────────────────── */
function render() {
    if (!S) return;
    applyTheme(S.config.theme);
    renderTop();
    renderFooter();
    renderHints();
    $('homeView').classList.toggle('hidden', view !== 'home');
    $('settingsView').classList.toggle('hidden', view !== 'settings');
    if (view === 'home') {
        $('homeView').classList.toggle('is-setup', S.status === 'setup');
        renderHero();
        renderShelf();
        renderDiscordPreview();
    } else {
        renderSettingsNav();
        renderSettingsPanel();
    }
    if (S.error && S.error !== lastToast && S.status !== 'setup') toast(S.error, 'error');
    lastToast = S.error;
}

function tick() {
    if (!S) return;
    $('clock').textContent = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    const timer = $('sessionTimer');
    if (timer && S.session) timer.textContent = fmtDuration(Date.now() - S.session.start);
    const elapsed = $('dcElapsed');
    if (elapsed && S.activity?.startTimestamp) elapsed.textContent = `${fmtDuration(Date.now() - S.activity.startTimestamp)} transcurrido`;
    renderFooter();
}

/* ── Acciones ──────────────────────────────────────── */
function openSettings(target) {
    view = 'settings';
    if (target) section = target;
    else if (S.status === 'setup' || !S.setup.friend) section = { consent: 'start', clientId: 'connection', login: 'account', friend: 'friend', discord: 'discord' }[firstPending()] ?? 'start';
    render();
    renderSettingsPanel(true);
}

async function setConfig(patch) {
    S = await api.setConfig(patch);
    render();
}

function configPatch(path, value) {
    const [a, b] = path.split('.');
    return b ? { [a]: { [b]: value } } : { [a]: value };
}

async function runLogin(fn) {
    loginBusy = true;
    loginError = null;
    renderSettingsPanel(true);
    const result = await fn();
    loginBusy = false;
    if (result.ok) {
        toast('Sesión iniciada. Ahora elige tu cuenta principal.');
        section = 'friend';
    } else if (!result.cancelled) {
        loginError = result.error;
    }
    S = await api.getState();
    render();
    renderSettingsPanel(true);
}

const actions = {
    'open-settings': el => openSettings(el.dataset.section),
    back: () => { view = 'home'; render(); },
    section: el => { section = el.dataset.section; loginError = null; renderSettingsNav(); renderSettingsPanel(true); },
    refresh: async () => { S = await api.refresh(); render(); },
    external: el => api.openExternal(el.dataset.url),
    'open-assets': () => api.openDiscordAssets(),
    theme: el => setConfig({ theme: el.dataset.theme }),
    'pick-friend': el => setConfig({ friendNsaId: el.dataset.id }).then(() => toast('Usuario elegido. Se mostrará su actividad.')),
    'save-field': el => {
        const field = el.dataset.field;
        setConfig({ [field]: $(field).value }).then(() => { toast('Guardado'); renderSettingsPanel(true); });
    },
    login: () => runLogin(() => api.login()),
    'login-url': () => runLogin(() => api.loginWithUrl($('loginUrl').value)),
    logout: async () => { S = await api.logout(); loginError = null; render(); renderSettingsPanel(true); },
};

document.addEventListener('click', event => {
    const winBtn = event.target.closest('[data-win]');
    if (winBtn) return api.window[winBtn.dataset.win]();
    const el = event.target.closest('[data-action]');
    if (el && actions[el.dataset.action]) {
        event.preventDefault();
        actions[el.dataset.action](el);
    }
});

document.addEventListener('change', event => {
    const el = event.target;
    if (!el.dataset.config) return;
    const value = el.type === 'checkbox' ? el.checked : el.value;
    setConfig(configPatch(el.dataset.config, value));
});

document.addEventListener('mouseover', event => {
    const tile = event.target.closest('.tile[data-caption]');
    const caption = tile ? tile.dataset.caption : null;
    if (caption === hoverCaption) return;
    hoverCaption = caption;
    const current = S?.recent?.[0]?.current ? S.recent[0].name : '';
    $('shelfCaption').textContent = hoverCaption ?? current;
});

document.addEventListener('keydown', event => {
    if (event.target.matches('input, select')) {
        if (event.key === 'Enter' && event.target.id && actions['save-field'] && ['nxapiClientId', 'discordClientId'].includes(event.target.id)) {
            setConfig({ [event.target.id]: event.target.value }).then(() => toast('Guardado'));
        }
        if (event.key === 'Enter' && event.target.id === 'loginUrl') actions['login-url']();
        return;
    }
    if (event.key === 'Escape' || event.key === 'Backspace' || event.key.toLowerCase() === 'b') {
        if (view === 'settings') { view = 'home'; render(); }
    } else if (event.key === '+' || event.key.toLowerCase() === 's') {
        if (view === 'home') openSettings();
    } else if (event.key.toLowerCase() === 'r') {
        actions.refresh();
    }
});

document.addEventListener('error', event => {
    if (event.target.tagName === 'IMG') event.target.style.visibility = 'hidden';
}, true);

api.onState(state => { S = state; render(); });
api.getState().then(state => {
    S = state;
    if (S.status === 'setup' && !S.setup.consent) { view = 'settings'; section = 'start'; }
    render();
    if (view === 'settings') renderSettingsPanel(true);
});
setInterval(tick, 1000);
