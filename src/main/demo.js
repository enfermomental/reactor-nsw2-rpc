// Datos simulados para `npm run demo`: permite ver la interfaz sin cuentas reales.

const svg = markup => 'data:image/svg+xml;base64,' + Buffer.from(markup).toString('base64');

const cover = (a, b, label) => svg(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="512" height="512" fill="url(#g)"/>
    <circle cx="390" cy="120" r="150" fill="#ffffff22"/><circle cx="90" cy="430" r="120" fill="#00000022"/>
    <text x="40" y="440" font-family="Segoe UI, sans-serif" font-weight="900" font-size="64" fill="#fff">${label}</text>
</svg>`);

const avatar = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <rect width="256" height="256" fill="#ffd27a"/><circle cx="128" cy="110" r="58" fill="#f6b38a"/>
    <path d="M60 64q68-60 136 0v26H60z" fill="#4a2f1f"/><circle cx="106" cy="112" r="8" fill="#2d2d2d"/><circle cx="150" cy="112" r="8" fill="#2d2d2d"/>
    <path d="M40 256q88-110 176 0z" fill="#00c3e3"/>
</svg>`);

const GAMES = [
    { name: 'Mario Kart World', imageUri: cover('#e60012', '#ff9f1c', 'MKW'), totalPlayTime: 7534, firstPlayedAt: 1749168000, sysDescription: 'Gran Premio · Copa Champiñón (150cc)', shopUri: 'https://www.nintendo.com/', state: 'PLAYING' },
    { name: 'Donkey Kong Bananza', imageUri: cover('#7b3f00', '#f2c94c', 'DKB'), totalPlayTime: 2290, firstPlayedAt: 1752710400, sysDescription: '', shopUri: 'https://www.nintendo.com/', state: 'ONLINE' },
];

export function demoFriends(startedAt) {
    const minutes = Math.floor((Date.now() - startedAt) / 60000);
    const game = GAMES[Math.floor(minutes / 3) % GAMES.length];
    return [{
        nsaId: 'demo-main',
        name: 'Reactor',
        imageUri: avatar,
        isFavoriteFriend: true,
        presence: {
            state: game.state,
            updatedAt: Math.floor(startedAt / 1000) - 47 * 60,
            logoutAt: 0,
            platform: 2,
            game: { ...game, totalPlayTime: game.totalPlayTime + minutes },
        },
    }, {
        nsaId: 'demo-friend',
        name: 'Luigi_99',
        imageUri: cover('#2fcf6a', '#0a7a3a', ''),
        isFavoriteFriend: false,
        presence: { state: 'INACTIVE', updatedAt: Math.floor(Date.now() / 1000) - 600, logoutAt: 0, game: {} },
    }];
}

export const DEMO_HISTORY = [
    { key: 'demo-zelda', name: 'The Legend of Zelda: Tears of the Kingdom', imageUri: cover('#1b4d3e', '#c9b458', 'TotK'), totalPlayTime: 12840, lastSessionMinutes: 95, lastPlayed: Date.now() - 86400000 },
    { key: 'demo-kirby', name: 'Kirby Air Riders', imageUri: cover('#ff7ab6', '#ffd1e8', 'KAR'), totalPlayTime: 310, lastSessionMinutes: 40, lastPlayed: Date.now() - 2 * 86400000 },
    { key: 'demo-pokemon', name: 'Pokémon Legends: Z-A', imageUri: cover('#1d3557', '#e63946', 'PLZA'), totalPlayTime: 4120, lastSessionMinutes: 120, lastPlayed: Date.now() - 4 * 86400000 },
];
