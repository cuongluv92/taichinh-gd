// ==========================================================================
// Thin wrappers for every taichinh_gd_* RPC endpoint. Same wire contract as
// the previous 36-file client (action names & payload fields unchanged) so
// the Supabase backend needs zero migration for this front-end rewrite.
// ==========================================================================
'use strict';

function needKey() { if (!state.key) throw new Error('Thiếu khóa gia đình'); }

const api = {
  core: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  debt: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_debt_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  goal: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_goal_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  categoryOrder: payload => { needKey(); return callRpc('taichinh_gd_category_order_api', { p_key: state.key, p_payload: payload }); },
  investment: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_investment_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  extension: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_extension_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  bankLoan: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_bank_loan_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  allocation: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_allocation_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  recurring: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_recurring_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  card: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_credit_card_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  cardPlan: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_credit_card_plan_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  cardMonth: month => { needKey(); return callRpc('taichinh_gd_credit_card_month_api', { p_key: state.key, p_month: monthDate(month) }); },
  reconciliation: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_reconciliation_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  exceptional: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_exceptional_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  fxHistory: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_fx_history_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  familySplit: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_family_split_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  statementImport: (action, payload = {}) => { needKey(); return callRpc('taichinh_gd_statement_import_api', { p_key: state.key, p_action: action, p_payload: payload }); },
  systemTx: () => { needKey(); return callRpc('taichinh_gd_system_tx_api', { p_key: state.key }); },
  backup: () => { needKey(); return callRpc('taichinh_gd_backup_api', { p_key: state.key }); },
  budgetColumn: (kind, effectiveMonth, rows) => { needKey(); return callRpc('taichinh_gd_budget_column_api', { p_key: state.key, p_kind: kind, p_effective_month: monthDate(effectiveMonth), p_rows: rows }); }
};

window.api = api;
