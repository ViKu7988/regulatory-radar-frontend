/**
 * dashboard.js — full compliance dashboard with partner selector,
 * fix suggestions, portfolio risk, ack tracking, multi-language alerts
 * EcoComply Regulatory Radar | IBM Bobathon 2025
 */

let _allPartners = [];
let _selectedPartner = null;
let _riskMap = {};

// ── Boot ───────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await Promise.all([loadPartners(), loadRegulations(), loadAlertLog(), loadPortfolioRisk()]);
});

// ── Load partners + build quick-selector ──────────────────────────────────────
async function loadPartners() {
  try {
    const data = await apiGet("/partners/");
    _allPartners = data.partners || [];

    // Load risk levels in parallel
    await Promise.all(_allPartners.map(async p => {
      try {
        const r = await apiGet(`/partners/${p.id}/risk`);
        _riskMap[p.id] = r.risk?.risk_level || "low";
      } catch { _riskMap[p.id] = "low"; }
    }));

    // Update KPIs
    const levels = Object.values(_riskMap);
    document.getElementById("kpiPartners").textContent  = _allPartners.length;
    document.getElementById("kpiCritical").textContent  = levels.filter(l => l === "critical").length;
    document.getElementById("kpiHigh").textContent      = levels.filter(l => l === "high").length;
    document.getElementById("kpiCompliant").textContent = levels.filter(l => l === "low").length;

    // Sort by risk
    const order = { critical:0, high:1, medium:2, low:3 };
    _allPartners.sort((a,b) => (order[_riskMap[a.id]]||3) - (order[_riskMap[b.id]]||3));

    buildPartnerSelector();

    // Auto-select Company X demo = SME001 (AlphaVolt GmbH) for live demo
    if (_allPartners.length) selectPartner(_allPartners[0].id);

  } catch(e) {
    document.getElementById("partnerQuickBtns").innerHTML =
      `<p class="loading-msg" style="color:var(--red)">Failed: ${e.message}</p>`;
  }
}

function buildPartnerSelector() {
  const wrap = document.getElementById("partnerQuickBtns");
  wrap.innerHTML = _allPartners.map(p => `
    <button class="pq-btn ${riskClass(_riskMap[p.id])}" id="pqb-${p.id}"
            onclick="selectPartner('${p.id}')">
      <span class="pq-name">${p.company_name}</span>
      <span class="pq-sector">${p.sector} · ${p.country}</span>
      <span class="pq-risk">● ${(_riskMap[p.id]||'low').toUpperCase()}</span>
    </button>
  `).join("") + `
    <button class="pq-btn" style="border-style:dashed;color:var(--accent);"
            onclick="window.location='onboard.html'">
      <span class="pq-name">+ Add your company</span>
      <span class="pq-sector">Live onboarding</span>
    </button>`;
}

// ── Select & inspect a partner ─────────────────────────────────────────────────
async function selectPartner(pid) {
  // Highlight selected button
  document.querySelectorAll(".pq-btn").forEach(b => b.classList.remove("active"));
  const btn = document.getElementById(`pqb-${pid}`);
  if (btn) btn.classList.add("active");

  _selectedPartner = pid;
  const card    = document.getElementById("partnerDetail");
  const content = document.getElementById("partnerDetailContent");
  card.classList.remove("hidden");
  content.innerHTML = `<p class="loading-msg">Loading ${pid}…</p>`;
  card.scrollIntoView({ behavior:"smooth", block:"nearest" });

  try {
    const [pData, riskData, matchData] = await Promise.all([
      apiGet(`/partners/${pid}`),
      apiGet(`/partners/${pid}/risk`),
      apiGet(`/partners/${pid}/matches`),
    ]);

    const p       = pData;
    const risk    = riskData.risk || {};
    const level   = risk.risk_level || "low";
    const matches = matchData.matches || [];

    content.innerHTML = `
      <div class="pd-header">
        <div>
          <div class="pd-title">${p.company_name}</div>
          <div class="pd-sub">${p.sector} · ${p.country} · ${p.employees||'?'} employees</div>
        </div>
        <span class="risk-badge ${level}" style="flex-shrink:0;">${level.toUpperCase()} RISK — Score ${risk.risk_score||0}/100</span>
      </div>

      <div class="pd-meta">
        <div><strong>Contact:</strong> ${p.contact_name}</div>
        <div><strong>Email:</strong> ${p.email||'—'}</div>
        <div><strong>Phone:</strong> ${p.phone||'—'}</div>
        <div><strong>Certifications:</strong> ${(p.certifications||[]).join(', ')||'—'}</div>
      </div>

      <div style="background:var(--surface);border-radius:8px;padding:12px 14px;font-size:13px;margin-bottom:16px;">
        ${risk.summary || 'No risk summary available.'}
      </div>

      <!-- Tabs -->
      <div class="pd-tabs">
        <button class="pd-tab active" onclick="switchTab('matches','${pid}')">📋 Regulations (${matches.length})</button>
        <button class="pd-tab" onclick="switchTab('fix','${pid}')">🔧 Fix Suggestions</button>
        <button class="pd-tab" onclick="switchTab('alert','${pid}')">📲 Send Alert</button>
      </div>

      <!-- Tab: Regulations matches -->
      <div class="pd-pane active" id="tab-matches">
        ${matches.length ? matches.map(m => `
          <div class="reg-list-item" style="margin-bottom:10px;">
            <div class="reg-urgency-dot urgency-${m.regulation?.urgency||'low'}"></div>
            <div style="flex:1;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <strong style="font-size:14px;">${m.regulation?.short_name||''}</strong>
                <span class="chip chip-blue">Score: ${m.score}</span>
              </div>
              <div style="font-size:12px;color:var(--muted);">${(m.match_reasons||[]).join(' · ')}</div>
              <div style="font-size:12px;font-weight:600;color:var(--orange);margin-top:3px;">📅 ${m.regulation?.deadline_date||'TBD'}</div>
            </div>
          </div>`) .join('') : '<p class="loading-msg">No regulations matched this profile.</p>'}
      </div>

      <!-- Tab: Fix suggestions (loaded on click) -->
      <div class="pd-pane" id="tab-fix">
        <div id="fixContent-${pid}"><p class="loading-msg">Click "Fix Suggestions" tab to load…</p></div>
      </div>

      <!-- Tab: Send alert -->
      <div class="pd-pane" id="tab-alert">
        <div class="alert-send-form">
          <h3>Send a live compliance alert</h3>
          <div class="field-row" style="margin-bottom:12px;">
            <div class="field-group">
              <label class="field-label">Regulation</label>
              <select id="alertRegSelect-${pid}" class="field-input">
                ${matches.map(m => `<option value="${m.regulation?.id}">${m.regulation?.short_name} (score ${m.score})</option>`).join('')}
              </select>
            </div>
            <div class="field-group">
              <label class="field-label">Channel</label>
              <div class="checkbox-row" style="margin-top:6px;">
                <label class="checkbox-label"><input type="checkbox" name="aChannel-${pid}" value="whatsapp"/> 💬 WhatsApp</label>
                <label class="checkbox-label"><input type="checkbox" name="aChannel-${pid}" value="sms"/> 📱 SMS</label>
                <label class="checkbox-label"><input type="checkbox" name="aChannel-${pid}" value="email" checked/> ✉️ Email</label>
              </div>
            </div>
            <div class="field-group">
              <label class="field-label">Language</label>
              <select id="alertLang-${pid}" class="field-input">
                <option value="en">🇬🇧 English</option>
                <option value="de">🇩🇪 Deutsch</option>
                <option value="fr">🇫🇷 Français</option>
                <option value="es">🇪🇸 Español</option>
                <option value="it">🇮🇹 Italiano</option>
                <option value="pl">🇵🇱 Polski</option>
              </select>
            </div>
            <div class="field-group" style="align-self:flex-end;">
              <button class="btn btn-primary" onclick="sendPartnerAlert('${pid}')">⚡ Send Alert</button>
            </div>
          </div>
          <div id="alertResult-${pid}"></div>
        </div>
      </div>
    `;

    // Pre-load fix suggestions
    loadFixSuggestions(pid, matches);

  } catch(e) {
    content.innerHTML = `<p style="color:var(--red)">Error: ${e.message}</p>`;
  }
}

function switchTab(name, pid) {
  document.querySelectorAll(".pd-tab").forEach((t,i) => {
    const names = ["matches","fix","alert"];
    t.classList.toggle("active", names[i] === name);
  });
  document.querySelectorAll(".pd-pane").forEach((p,i) => {
    const names = ["matches","fix","alert"];
    p.classList.toggle("active", names[i] === name);
  });
}

async function loadFixSuggestions(pid, matches) {
  const el = document.getElementById(`fixContent-${pid}`);
  if (!el || !matches.length) return;

  const fixes = [];
  for (const m of matches.slice(0, 4)) {
    try {
      const f = await apiGet(`/alerts/fix/${pid}/${m.regulation?.id}`);
      fixes.push(f);
    } catch {}
  }

  if (!fixes.length) { el.innerHTML = '<p class="loading-msg">No fix data available.</p>'; return; }

  fixes.sort((a,b) => b.priority_score - a.priority_score);

  el.innerHTML = fixes.map(f => `
    <div style="border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong style="font-size:14px;">${f.regulation}</strong>
        ${urgencyChip(f.urgency)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px;margin-bottom:10px;">
        <div style="background:var(--surface);padding:8px;border-radius:6px;text-align:center;">
          <div style="font-weight:700;font-size:16px;color:var(--accent);">${f.priority_score}</div>
          <div style="color:var(--muted);">Priority</div>
        </div>
        <div style="background:var(--surface);padding:8px;border-radius:6px;text-align:center;">
          <div style="font-weight:700;font-size:16px;color:var(--red);">€${f.estimated_fine_eur.toLocaleString()}</div>
          <div style="color:var(--muted);">Est. Exposure</div>
        </div>
        <div style="background:var(--surface);padding:8px;border-radius:6px;text-align:center;">
          <div style="font-weight:700;font-size:16px;color:${f.days_to_deadline < 180 ? 'var(--orange)':'var(--muted)'};">${f.days_to_deadline ?? '?'}</div>
          <div style="color:var(--muted);">Days left</div>
        </div>
      </div>
      <div class="priority-bar"><div class="priority-fill pf-${f.urgency}" style="width:${f.priority_score}%"></div></div>
      <div style="margin-top:10px;font-size:13px;background:#f0f4ff;border-left:3px solid var(--accent);padding:8px 12px;border-radius:0 6px 6px 0;">
        💡 <strong>Immediate action:</strong> ${f.immediate_action}
      </div>
      <div class="fix-step-list">
        ${(f.fix_steps||[]).map(s => `
          <div class="fix-step">
            <div class="fix-step-n">${s.step}</div>
            <div class="fix-step-body">
              <div class="fix-step-action">${s.action}</div>
              <div class="fix-step-meta">Owner: ${s.owner} · Effort: ${s.effort}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

// ── Send a live alert from the detail panel ────────────────────────────────────
async function sendPartnerAlert(pid) {
  const regId    = document.getElementById(`alertRegSelect-${pid}`)?.value;
  const langEl   = document.getElementById(`alertLang-${pid}`);
  const language = langEl?.value || "en";
  const channels = Array.from(document.querySelectorAll(`[name="aChannel-${pid}"]:checked`))
                        .map(c => c.value);
  const resultEl = document.getElementById(`alertResult-${pid}`);

  if (!regId)           { toast("Please select a regulation", "error"); return; }
  if (!channels.length) { toast("Select at least one channel", "error"); return; }

  resultEl.innerHTML = `<p class="loading-msg">Sending…</p>`;
  try {
    const res = await apiPost("/alerts/send", {
      partner_id: pid, regulation_id: regId, channels, language
    });
    const results = res.send_results || [];
    const ok      = results.filter(r => ["sent","demo_sent"].includes(r.status));
    const failed  = results.filter(r => r.status === "failed");

    resultEl.innerHTML = `
      <div style="margin-top:12px;">
        ${ok.map(r => `
          <div class="alert-item" style="background:#f0fdf4;border-color:var(--green);margin-bottom:6px;">
            <div class="alert-icon">${channelIcon(r.channel)}</div>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--green);">
                ${r.status === 'sent' ? '✅ Delivered' : '🔵 Demo Sent'} via ${r.channel.toUpperCase()}
              </div>
              <div style="font-size:12px;color:var(--muted);">${r.to||''}</div>
            </div>
          </div>`).join('')}
        ${failed.map(r => `
          <div class="alert-item" style="background:#fef2f2;border-color:var(--red);margin-bottom:6px;">
            <div class="alert-icon">❌</div>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--red);">Failed — ${r.channel}</div>
              <div style="font-size:12px;color:var(--muted);">${r.error||''}</div>
            </div>
          </div>`).join('')}
        <div style="font-size:12px;font-style:italic;color:var(--muted);margin-top:8px;padding:8px;background:var(--surface);border-radius:6px;">
          "${(res.message||'').slice(0,200)}…"
        </div>
      </div>`;

    if (ok.length) {
      toast(`Alert sent! ${ok.map(r=>r.channel).join(', ')}`, "success");
      setTimeout(() => refreshAlertLog(), 800);
    } else if (failed.length) {
      toast(failed[0].error?.slice(0,80) || "Send failed", "error");
    }
  } catch(e) {
    resultEl.innerHTML = `<p style="color:var(--red)">Error: ${e.message}</p>`;
    toast(e.message, "error");
  }
}

// ── Portfolio risk financial dashboard ────────────────────────────────────────
async function loadPortfolioRisk() {
  const el = document.getElementById("riskDashboard");
  try {
    const data = await apiGet("/partners/portfolio-risk");
    document.getElementById("kpiExposure").textContent =
      `€${Math.round(data.total_exposure_eur/1000)}k`;

    const rows = (data.report || []).map(r => {
      const topFix = r.fixes?.[0];
      return `
        <tr class="risk-row-${r.risk_level}" onclick="selectPartner('${r.partner_id}')" style="cursor:pointer;">
          <td><strong>${r.company_name}</strong><br><span style="font-size:11px;color:var(--muted);">${r.sector} · ${r.country}</span></td>
          <td>${urgencyChip(r.risk_level)}</td>
          <td><div style="font-size:13px;">${r.regulations_matched}</div></td>
          <td class="exposure">€${r.total_exposure_eur.toLocaleString()}</td>
          <td>
            <div class="priority-bar" style="width:100px;">
              <div class="priority-fill pf-${r.risk_level}" style="width:${r.max_priority_score}%"></div>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">${r.max_priority_score}/100</div>
          </td>
          <td style="font-size:12px;color:var(--muted);">${topFix?.immediate_action?.slice(0,60)||'—'}…</td>
        </tr>`;
    }).join('');

    el.innerHTML = `
      <div style="display:flex;gap:16px;margin-bottom:14px;font-size:13px;flex-wrap:wrap;">
        <div style="background:#fee2e2;color:var(--red);padding:8px 14px;border-radius:8px;font-weight:600;">
          🔴 ${(data.report||[]).filter(r=>r.risk_level==='critical').length} Critical
        </div>
        <div style="background:#fef3c7;color:var(--orange);padding:8px 14px;border-radius:8px;font-weight:600;">
          🟠 ${(data.report||[]).filter(r=>r.risk_level==='high').length} High
        </div>
        <div style="background:#e8f0fe;color:var(--accent);padding:8px 14px;border-radius:8px;font-weight:600;">
          💶 Total exposure: <strong>€${data.total_exposure_eur.toLocaleString()}</strong>
        </div>
      </div>
      <div class="risk-table-wrap">
        <table class="risk-table">
          <thead><tr>
            <th>Partner</th><th>Risk</th><th>Regs</th>
            <th>Est. Exposure</th><th>Priority</th><th>Top Action</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:8px;">
        Click any row to inspect the partner's full risk profile. Exposure is estimated based on revenue and urgency. Not legal advice.
      </p>`;
  } catch(e) {
    el.innerHTML = `<p style="color:var(--red)">Failed to load risk data: ${e.message}</p>`;
  }
}

// ── Regulations list ───────────────────────────────────────────────────────────
async function loadRegulations() {
  const list = document.getElementById("regList");
  try {
    const data = await apiGet("/regulations/");
    const regs = data.regulations || [];
    document.getElementById("regCount").textContent = regs.length;
    list.innerHTML = regs.map(r => `
      <div class="reg-list-item">
        <div class="reg-urgency-dot urgency-${r.urgency||'low'}"></div>
        <div>
          <div class="reg-list-title">${r.short_name||r.title}</div>
          <div class="reg-list-meta">${r.regulation_number||''}</div>
          <div class="reg-list-deadline">📅 ${r.deadline_date||'TBD'}</div>
        </div>
        ${urgencyChip(r.urgency)}
      </div>`).join('');
  } catch(e) {
    list.innerHTML = `<p class="loading-msg" style="color:var(--red)">${e.message}</p>`;
  }
}

// ── Alert log with ack ────────────────────────────────────────────────────────
async function refreshAlertLog() { await loadAlertLog(); }

async function loadAlertLog() {
  const list = document.getElementById("alertLogList");
  try {
    const data   = await apiGet("/alerts/log");
    const alerts = data.alerts || [];
    if (!alerts.length) {
      list.innerHTML = "<p class='loading-msg'>No alerts yet.</p>";
      return;
    }
    list.innerHTML = alerts.slice(0, 20).map(a => `
      <div class="alert-log-item status-${a.status}">
        <div class="log-header">
          <span class="log-title">${channelIcon(a.channel)} ${a.partner_id} → ${a.regulation_id}</span>
          <span class="log-time">${timeAgo(a.timestamp)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:3px 0;">
          <span class="log-channel">${a.channel}</span>
          ${statusChip(a.status)}
          ${a.language && a.language !== 'en' ? `<span class="chip chip-gray">${a.language.toUpperCase()}</span>` : ''}
          ${a.acknowledged
            ? `<span class="acked-badge">✓ Acknowledged</span>`
            : `<button class="ack-btn" onclick="ackAlert('${a.alert_id}', this)">Mark read</button>`}
        </div>
        ${a.message_preview ? `<div class="log-preview">"${a.message_preview}"</div>` : ''}
      </div>`).join('');
  } catch(e) {
    list.innerHTML = `<p class="loading-msg" style="color:var(--red)">${e.message}</p>`;
  }
}

async function ackAlert(alertId, btn) {
  try {
    await apiPost(`/alerts/${alertId}/acknowledge`, {});
    btn.replaceWith(Object.assign(document.createElement("span"), {
      className: "acked-badge", textContent: "✓ Acknowledged"
    }));
  } catch(e) {
    toast("Could not acknowledge: " + e.message, "error");
  }
}
