// ==========================================================================
// Cài đặt — system-wide configuration only. Per-column category settings
// live in Chi tiêu's own ⚙ buttons (see modals.js openColumnSettings) so
// nothing is configured twice.
// ==========================================================================
'use strict';

async function saveHousehold(e) {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.currentTarget).entries());
  try { await api.core('save_household', fd); await window.refresh(); toast('Đã lưu cài đặt'); }
  catch (err) { toast(err.message, true); }
}
async function saveReporting(e) {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.currentTarget).entries());
  const show = !!e.currentTarget.querySelector('[name="show_vnd_conversion"]')?.checked;
  try {
    await api.extension('save_reporting', { show_vnd_conversion: show, jpy_vnd_rate: fd.jpy_vnd_rate || null });
    await window.refresh(); toast('Đã lưu tỷ giá');
  } catch (err) { toast(err.message, true); }
}

function deviceSessionRow(d) {
  const revoked = !!d.revoked_at;
  const lastSeen = esc(String(d.last_seen_at || d.created_at).slice(0, 16).replace('T', ' '));
  return `<div class="tx"><div class="tx-main">
      <strong>${esc(d.device_label)}${d.is_current ? ' <span class="status-chip good">Thiết bị này</span>' : ''}${revoked ? ' <span class="status-chip bad">Đã đăng xuất</span>' : ''}</strong>
      <span>${revoked ? `Đã đăng xuất lúc ${esc(String(d.revoked_at).slice(0, 16).replace('T', ' '))}` : `Hoạt động lần cuối ${lastSeen}`}</span>
    </div>
    <div class="tx-actions">${revoked ? '' : `<button class="btn sm danger" ${act('revokeDevice', d.id)}>Đăng xuất thiết bị này</button>`}</div>
  </div>`;
}
async function revokeDevice(id) {
  if (!confirm('Đăng xuất thiết bị này? Thiết bị đó sẽ bị khóa ngay ở lượt truy cập tiếp theo.')) return;
  try { await api.extension('revoke_device', { device_id: id }); await window.refresh(); toast('Đã đăng xuất thiết bị'); }
  catch (e) { toast(e.message, true); }
}
function renderSettings() {
  const r = state.reporting || {};
  return `<div class="grid two-cols">
    <section class="card">
      <h2>Gia đình</h2>
      <form id="householdForm" class="form-grid">
        <div class="field"><label>Tên hiển thị</label><input name="name" value="${esc(state.household?.name || 'Gia đình')}" required></div>
        <div class="field"><label>Tiền tệ chính</label><select name="base_currency"><option value="JPY" ${state.base === 'JPY' ? 'selected' : ''}>JPY · Yên Nhật</option><option value="VND" ${state.base === 'VND' ? 'selected' : ''}>VND · Đồng Việt Nam</option></select></div>
        <div class="field full"><button class="btn primary" type="submit">Lưu thay đổi</button></div>
      </form>
    </section>
    <section class="card">
      <h2>Quy đổi JPY ↔ VND</h2>
      <p class="note">Chỉ dùng để hiển thị tổng quy đổi; số tiền gốc trong tài khoản không đổi. App không tự lấy tỷ giá — bạn quyết định số dùng cho báo cáo.</p>
      <form id="reportingForm" class="form-grid">
        <div class="field full"><label class="checkbox-label"><input type="checkbox" name="show_vnd_conversion" ${r.show_vnd_conversion ? 'checked' : ''}> Bật hiển thị quy đổi VND</label></div>
        <div class="field full"><label>1 JPY =</label><input name="jpy_vnd_rate" type="number" min="0.000001" step="0.000001" value="${esc(r.jpy_vnd_rate ?? '')}" placeholder="VD: 168"></div>
        <div class="field full"><button class="btn primary" type="submit">Lưu tỷ giá</button></div>
      </form>
    </section>
  </div>
  <div class="grid two-cols mt-16">
    <section class="card">
      <h2>Khóa gia đình &amp; thiết bị</h2>
      <p class="note">Link riêng chứa khóa trong phần # của URL và không gửi lên máy chủ Vercel. Chỉ chia sẻ với người trong gia đình.</p>
      <div class="stack">
        <button class="btn" ${act('copyPrivateLink')}>⧉ Sao chép link riêng cho thiết bị khác</button>
        <button class="btn danger" ${act('forgetDevice')}>Xóa khóa khỏi thiết bị này</button>
        <small class="muted">Xóa khóa chỉ làm thiết bị hiện tại mất quyền mở app; dữ liệu trong Supabase không bị xóa.</small>
      </div>
      <h4 class="mt-16">Thiết bị đăng nhập</h4>
      <p class="note">Mọi thiết bị dùng chung một khóa gia đình — danh sách dưới đây là những thiết bị đã từng mở app. Đăng xuất một thiết bị không đổi khóa chung, chỉ khóa riêng thiết bị đó ngay ở lượt truy cập tiếp theo.</p>
      <div class="list">${(state.deviceSessions || []).map(deviceSessionRow).join('') || '<div class="empty compact">Chưa ghi nhận thiết bị nào.</div>'}</div>
    </section>
    <section class="card">
      <h2>Sao lưu dữ liệu</h2>
      <p class="note">Tải toàn bộ dữ liệu gia đình (tài khoản, danh mục, giao dịch, nợ, thẻ...) dưới dạng JSON, hoặc chỉ danh sách giao dịch dưới dạng CSV để mở bằng Excel.</p>
      <div class="row"><button class="btn primary" ${act('exportData')}>⇩ Tải bản sao đầy đủ (JSON)</button><button class="btn" ${act('exportCsv')}>⇩ Xuất CSV giao dịch</button></div>
      <h4 class="mt-16">Thùng rác</h4>
      <p class="note">Giao dịch bị xóa vẫn giữ lại 50 lần gần nhất — lỡ xóa nhầm thì khôi phục lại được, không mất hẳn ngay.</p>
      <button class="btn" ${act('openTrash')}>🗑 Xem thùng rác</button>
    </section>
  </div>`;
}

function wireSettingsView() {
  $('#householdForm')?.addEventListener('submit', saveHousehold);
  $('#reportingForm')?.addEventListener('submit', saveReporting);
}

Object.assign(window, { renderSettings, saveHousehold, saveReporting, revokeDevice });
