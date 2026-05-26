"use strict";
/**
 * Serialize MetatraderAPI ConnectEx / hard reconnect per broker server.
 * See supabase/functions/_shared/mtServerSessionLock.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MT_SAME_SERVER_GAP_MS = void 0;
exports.withMtServerSessionLock = withMtServerSessionLock;
exports.mtServerLockKey = mtServerLockKey;
exports.pauseIfSameMtServer = pauseIfSameMtServer;
const chains = new Map();
function serverLockKey(platform, server) {
    return `${String(platform ?? 'MT5').toUpperCase()}:${String(server ?? '').trim().toLowerCase()}`;
}
function withMtServerSessionLock(platform, server, fn) {
    const key = serverLockKey(platform, server);
    const prev = chains.get(key) ?? Promise.resolve();
    const run = prev.catch(() => { }).then(fn);
    chains.set(key, run.then(() => { }, () => { }));
    return run;
}
function mtServerLockKey(platform, server) {
    return serverLockKey(platform, server);
}
/** Pause between operations when multiple accounts share a server. */
exports.MT_SAME_SERVER_GAP_MS = Math.max(800, Number(process.env.MT_SAME_SERVER_GAP_MS ?? 1500) || 1500);
async function pauseIfSameMtServer(lastKey, platform, server) {
    const key = serverLockKey(platform, String(server ?? ''));
    if (lastKey && lastKey === key) {
        await new Promise(r => setTimeout(r, exports.MT_SAME_SERVER_GAP_MS));
    }
    return key;
}
