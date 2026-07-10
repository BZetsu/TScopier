"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTrialEnded = isTrialEnded;
exports.isSubscriptionActive = isSubscriptionActive;
exports.effectivePlan = effectivePlan;
exports.manualSettingsUseAdvancedFeatures = manualSettingsUseAdvancedFeatures;
/** True when trial_ends_at is a parseable timestamp strictly before `now`. */
function isTrialEnded(trialEndsAt, now = new Date()) {
    if (trialEndsAt == null || trialEndsAt === '')
        return false;
    const end = typeof trialEndsAt === 'string' ? Date.parse(trialEndsAt) : trialEndsAt.getTime();
    if (!Number.isFinite(end))
        return false;
    return end < now.getTime();
}
/**
 * Paid `active` always counts. `trialing` counts only while trial_ends_at is
 * unset/unparseable or still in the future.
 */
function isSubscriptionActive(status, trialEndsAt) {
    if (status === 'active')
        return true;
    if (status === 'trialing')
        return !isTrialEnded(trialEndsAt);
    return false;
}
function effectivePlan(plan, status, trialEndsAt) {
    if (!isSubscriptionActive(status, trialEndsAt))
        return null;
    return plan ?? null;
}
function manualSettingsUseAdvancedFeatures(settings) {
    if (settings.trade_style === 'multi')
        return true;
    if (settings.range_trading === true)
        return true;
    if (settings.reverse_signal === true)
        return true;
    if (settings.close_worse_entries === true)
        return true;
    const beMode = String(settings.move_sl_to_entry_after_mode ?? 'none');
    if (beMode !== 'none' && beMode !== '')
        return true;
    if (settings.rr_for_sl_enabled === true || settings.rr_for_tps_enabled === true)
        return true;
    return false;
}
