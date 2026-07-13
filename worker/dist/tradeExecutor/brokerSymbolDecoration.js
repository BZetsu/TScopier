"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasLegacySymbolDecoration = hasLegacySymbolDecoration;
exports.stripSymbolDecoration = stripSymbolDecoration;
exports.clearLegacySymbolDecorationIfPresent = clearLegacySymbolDecorationIfPresent;
function hasLegacySymbolDecoration(manual) {
    const prefix = String(manual.symbol_prefix ?? '').trim();
    const suffix = String(manual.symbol_suffix ?? '').trim();
    const mapping = manual.symbol_mapping;
    const hasMap = mapping != null
        && typeof mapping === 'object'
        && Object.keys(mapping).length > 0;
    return prefix.length > 0 || suffix.length > 0 || hasMap;
}
function stripSymbolDecoration(manual) {
    return {
        ...manual,
        symbol_prefix: '',
        symbol_suffix: '',
        symbol_mapping: {},
    };
}
/** Remove stored prefix/suffix/map so runtime fuzzy broker matching is used. */
async function clearLegacySymbolDecorationIfPresent(supabase, broker) {
    const manual = (broker.manual_settings ?? {});
    if (!hasLegacySymbolDecoration(manual))
        return false;
    const nextSettings = stripSymbolDecoration(manual);
    const { error } = await supabase
        .from('broker_accounts')
        .update({ manual_settings: nextSettings })
        .eq('id', broker.id);
    if (error) {
        console.warn(`[tradeExecutor] clear legacy symbol decoration failed broker=${broker.id}: ${error.message}`);
        return false;
    }
    broker.manual_settings = nextSettings;
    console.log(`[tradeExecutor] cleared legacy symbol decoration broker=${broker.id} (auto-match enabled)`);
    return true;
}
