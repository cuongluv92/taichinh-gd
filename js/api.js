// ==========================================================================
// Thin wrappers for the taichinh_gd_* RPC endpoints this frontend actually
// uses (same action names/payloads as the Supabase functions, so the
// backend needs zero migration). The database also still has RPCs for
// recurring-expense reminders, a second credit-card "overview" summary,
// monthly FX history, family-expense splitting, bank-statement import, and
// balance reconciliation — all intact, none wired into this simplified UI
// (see the handoff notes for why). Add a wrapper here if any of those get
// built later; there's no reason to keep an unused one lying around now.
// ==========================================================================
'use strict';

function needKey() { if (!state.key) throw new Error('Thiếu khóa gia đình'); }

const api = {
  core: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  investment: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_investment_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  // Every extension.* action shares one session check server-side (see the
  // device_sessions migration) — session_token rides along on every call so
  // a revoked device is blocked no matter which action it happens to hit
  // next, not just "get". An explicit payload.session_token (none today)
  // would still win via the spread order below.
  extension: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_extension_api', { p_key: state.key, p_action: action, p_payload: { session_token: state.deviceToken, ...payload } }); },
  accountAdjustment: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_account_adjustment_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  cardLedger: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_card_ledger_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  debtLedger: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_debt_ledger_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  recurringAccount: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_recurring_account_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  exceptional: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_exceptional_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  backup: () => { needKey(); return callRpc('taichinh_gd_backup_api', { p_key: state.key }); },
  budgetColumn: (kind, effectiveMonth, rows) => { needKey(); return callRpc('taichinh_gd_budget_column_api', { p_key: state.key, p_kind: kind, p_effective_month: monthDate(effectiveMonth), p_rows: rows }); }
};

window.api = api;
