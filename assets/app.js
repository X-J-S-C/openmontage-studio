// OpenMontage Studio - 前端交互 (T6 重写版)
// 工位对话：tab 切换、消息渲染、发送、轮询；加载/空/错三态
// 鉴权：fetch 请求凭证走请求头 X-Hana-Plugin-Surface-Session（防 token 进 URL/日志）；
// 仅 <img>/<video> 等无法自定义请求头的资源直链才回退到 query（宿主两者皆收）。

(function () {
  'use strict';

  // ── motion（GSAP，本地打包，离线可用；尊重系统减弱动效设置）──
  var PREFERS_REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function gsapSafe() { return !PREFERS_REDUCED && typeof window.gsap !== 'undefined' && typeof window.gsap.to === 'function'; }

  // 胶片帧条交错浮现（页面首次载入）
  function animateFilmstrip() {
    if (!gsapSafe()) return;
    var frames = document.querySelectorAll('.filmstrip .frame');
    if (!frames.length) return;
    window.gsap.from(frames, { autoAlpha: 0, y: 8, duration: 0.42, stagger: 0.045, ease: 'power2.out', clearProps: 'all' });
  }

  // 工位对话内容淡入（切换工位/新消息渲染后）
  function animateThreadIn() {
    if (!gsapSafe()) return;
    var t = $('threadText');
    if (!t) return;
    window.gsap.fromTo(t, { autoAlpha: 0.45, y: 4 }, { autoAlpha: 1, y: 0, duration: 0.24, ease: 'power1.out' });
  }

  // 进度条宽度从 0 流动到目标值（仅首次出现时，轮询重渲染不重复动）
  function animateBar(el) {
    if (!gsapSafe() || !el) return;
    var target = parseFloat(el.getAttribute('data-p') || el.style.width || '0');
    if (isNaN(target)) target = 0;
    window.gsap.fromTo(el, { width: '0%' }, { width: target + '%', duration: 0.55, ease: 'power2.out' });
  }

  // 模态框：遮罩淡入 + 卡片回弹弹出（back.out，有“弹出来”的手感）
  function animateModalOpen(mask) {
    if (!gsapSafe() || !mask) return;
    window.gsap.fromTo(mask, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.16, ease: 'power1.out' });
    var m = mask.querySelector('.modal');
    if (!m) return;
    window.gsap.fromTo(m, { scale: 0.94, autoAlpha: 0, y: 10 }, { scale: 1, autoAlpha: 1, y: 0, duration: 0.34, ease: 'back.out(1.7)' });
  }

  // 全局错误捕获：任何 JS 错误直接显示在页面上，避免黑屏无反馈
  window.addEventListener('error', function (e) {
    try {
      var el = document.getElementById('fatalError');
      if (!el) {
        el = document.createElement('div');
        el.id = 'fatalError';
        el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99;background:#faf0ee;color:#b05f52;border-bottom:1px solid #e0b5ac;padding:10px 16px;font-size:12px;font-family:monospace;white-space:pre-wrap;word-break:break-all;';
        document.body.appendChild(el);
      }
      el.textContent = 'JS 错误: ' + (e.message || e.type || 'unknown') + '\n' + (e.filename || '') + ':' + (e.lineno || '');
    } catch (err) { /* 兜底 */ }
  });
  window.addEventListener('unhandledrejection', function (e) {
    try {
      var el = document.getElementById('fatalError');
      if (el) el.textContent = 'Promise 错误: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason));
    } catch (err) { /* 兜底 */ }
  });

  var PROJECT_ID = window.PROJECT_ID || '';
  // 工位列表由服务端注入（agent id 来自用户配置）；注入缺失时回退默认三工位
  var AGENTS = window.AGENTS || [
    { id: 'bianju', name: '编' },
    { id: 'daoyan', name: '导' },
    { id: 'zhizuo', name: '制' },
  ];
  var currentAgent = 'bianju';
  var pollTimer = null;
  var busy = false;

  // 凭证持久化：首次加载把 pluginSurfaceSession 存入 sessionStorage，
  // 防止 location.href 跳转（如切项目）丢失凭证导致 403 missing_credential
  (function persistToken() {
    try {
      var params = new URLSearchParams(window.location.search);
      var surface = params.get('pluginSurfaceSession');
      if (surface) sessionStorage.setItem('pluginSurfaceSession', surface);
    } catch (e) { /* 存储不可用则忽略 */ }
  })();

  function baseUrl() {
    var p = window.location.pathname;
    return p.replace(/\/montage\/?$/, '').replace(/\/+$/, '') || '';
  }
  var API = baseUrl();

  function surfaceSession() {
    var surface = '';
    try {
      var params = new URLSearchParams(window.location.search);
      surface = params.get('pluginSurfaceSession') || '';
      if (!surface) {
        surface = sessionStorage.getItem('pluginSurfaceSession') || '';
      }
    } catch (e) { /* 环境异常则视为无凭证 */ }
    return surface;
  }
  function authQuery() {
    var s = surfaceSession();
    return s ? 'pluginSurfaceSession=' + encodeURIComponent(s) : '';
  }
  // withAuth：仅用于无法自定义请求头的资源直链（<img>/<video> 预览）。
  // 凭证仍走 query（宿主同时接受 header 与 query），避免预览因缺凭证 403。
  function withAuth(url) {
    var q = authQuery();
    if (!q) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + q;
  }
  // fetch 请求：凭证走请求头 X-Hana-Plugin-Surface-Session，避免 token 进入 URL
  // （减少 access log / referrer / 历史记录中的凭证泄漏）。宿主 header 优先。
  function withAuthHeaders(opts) {
    var o = Object.assign({}, opts || {});
    var headers = Object.assign({}, o.headers || {});
    var s = surfaceSession();
    if (s) headers['X-Hana-Plugin-Surface-Session'] = s;
    o.headers = headers;
    return o;
  }
  function authFetch(url, opts) {
    return fetch(url, withAuthHeaders(opts));
  }

  // 宿主桥接探测：手册记载官方方式为 window.hana.api.fetch（自动带凭证）
  function hanaApiInfo() {
    var h = window.hana;
    return {
      hasHana: !!h,
      hasApi: !!(h && h.api),
      hasFetch: !!(h && h.api && typeof h.api.fetch === 'function'),
      keys: h ? Object.keys(h).join(',') : '',
    };
  }
  // 写操作优先走宿主桥接；不存在或抛错则回退原生 fetch
  function apiWrite(path, options) {
    var info = hanaApiInfo();
    if (info.hasFetch) {
      try {
        return window.hana.api.fetch(path, options);
      } catch (e) {
        return fallbackWrite(path, options, info);
      }
    }
    return fallbackWrite(path, options, info);
  }
  function fallbackWrite(path, options, info) {
    var p = new Promise(function (resolve) {
      authFetch(API + path, options)
        .then(function (r) { return r.json().catch(function () { return { httpStatus: r.status }; }); })
        .then(function (d) { resolve(Object.assign({ _fallback: true, _hana: info }, d)); })
        .catch(function (e) { resolve({ _fallback: true, _hana: info, _fetchError: e.message }); });
    });
    return p;
  }

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function textToHtml(t) {
    return esc(t).replace(/\n/g, '<br>');
  }

  // ── 渲染 ──
  function renderTabs() {
    var box = $('tabs');
    if (!box) return;
    box.innerHTML = AGENTS.map(function (a) {
      return '<button class="tab' + (a.id === currentAgent ? ' on' : '') + '" data-agent="' + esc(a.id) + '">' + esc(a.name) + '</button>';
    }).join('');
    box.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-agent')); });
    });
  }

  function renderThread(data) {
    var box = $('threadText');
    var meta = $('threadMeta');
    if (!box) return;
    box.classList.remove('thinking');
    if (meta) {
      meta.textContent = data.sessionId
        ? '会话 ' + data.sessionId.slice(0, 14) + '… · ' + data.messageCount + ' 条消息'
        : '未连接';
    }
    if (data.text) {
      box.innerHTML = textToHtml(data.text);
    } else {
      box.innerHTML = '<span class="ph">会话已就绪。向' + currentAgentName() + '提出这条工序的需求，开始协作。</span>';
    }
    animateThreadIn();
  }

  function renderError(msg, hint) {
    var box = $('threadText');
    if (!box) return;
    box.classList.remove('thinking');
    var html = '<span class="err-text">' + esc(msg) + '</span>';
    if (hint) html += '<div class="err-hint">' + esc(hint) + '</div>';
    box.innerHTML = html;
  }

  function currentAgentName() {
    for (var i = 0; i < AGENTS.length; i++) {
      if (AGENTS[i].id === currentAgent) return AGENTS[i].name;
    }
    return '';
  }

  // ── 工件库 ──
  function loadArtifacts() {
    if (!PROJECT_ID) return;
    authFetch(API + '/api/artifacts?projectId=' + encodeURIComponent(PROJECT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) renderArtifacts(d.artifacts || []);
      })
      .catch(function () { /* 静默，下次轮询重试 */ });
  }

  var groupMode = 'stage';
  var GROUP_LABELS = { stage: '按阶段', type: '按类型', status: '按状态' };

  function artifactKey(a) {
    if (groupMode === 'type') return a.type || '未分类';
    if (groupMode === 'status') return a.stageStatus || '未知';
    return a.stageName || a.stageId || '未分类';
  }

  function artifactItemHtml(a) {
    return '<div class="artifact-item" data-path="' + esc(a.path) + '" title="' + esc(a.title || a.path) + '">' +
      '<span class="artifact-type">' + esc(a.type) + '</span>' +
      '<span class="artifact-name">' + esc(a.title || a.path) + '</span>' +
      '<span class="artifact-ver">v' + esc(a.version) + '</span>' +
      (groupMode === 'stage' ? '<span class="artifact-stage">' + esc(a.stageName || '') + '</span>' : '') +
      '<span class="deliver-btn" data-deliver="' + esc(a.path) + '" title="投递到桌面端工作台预览">⇥</span>' +
      '</div>';
  }

  function renderArtifacts(items) {
    var box = $('artifactList');
    if (!box) return;
    if (!items.length) {
      box.innerHTML = '<div class="artifact-empty">工序产出的工件将在这里归档</div>';
      return;
    }
    var ctrl = '<div class="group-tabs">' + ['stage', 'type', 'status'].map(function (m) {
      return '<button class="gtab' + (m === groupMode ? ' on' : '') + '" data-g="' + m + '">' + GROUP_LABELS[m] + '</button>';
    }).join('') + '</div>';

    var groups = {};
    items.forEach(function (a) {
      var k = artifactKey(a);
      (groups[k] = groups[k] || []).push(a);
    });
    var order = Object.keys(groups).sort();
    var html = ctrl + order.map(function (k) {
      return '<div class="group"><div class="group-title">' + esc(k) + '</div>' +
        groups[k].map(artifactItemHtml).join('') + '</div>';
    }).join('') + '<div class="artifact-preview" id="artifactPreview"></div>';
    box.innerHTML = html;
    box.querySelectorAll('.gtab').forEach(function (btn) {
      btn.addEventListener('click', function () { groupMode = btn.getAttribute('data-g'); renderArtifacts(items); });
    });
    box.querySelectorAll('.artifact-item').forEach(function (item) {
      item.addEventListener('click', function () { previewArtifact(item.getAttribute('data-path')); });
    });
    box.querySelectorAll('[data-deliver]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        deliverArtifact(btn.getAttribute('data-deliver'));
      });
    });
  }

  // ── 投递到桌面端工作台 ──
  function deliverArtifact(path) {
    if (!PROJECT_ID || !path) return;
    apiWrite('/api/desk-deliver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: PROJECT_ID, path: path }),
    })
      .then(function (d) {
        if (d.ok) hostToast('已投递到工作台: ' + path, 'success');
        else renderError(d.error || ('投递失败: ' + path));
      })
      .catch(function (e) { renderError('投递失败: ' + e.message); });
  }

  function deliverAll() {
    authFetch(API + '/api/artifacts?projectId=' + encodeURIComponent(PROJECT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var list = (d.ok && d.artifacts) || [];
        if (!list.length) { renderError('没有可投递的工件'); return; }
        var paths = list.map(function (a) { return a.path; });
        var done = 0, failed = 0, firstErr = '';
        (function nextDeliver() {
          if (done + failed >= paths.length) {
            if (failed === 0) {
              hostToast('已投递 ' + done + ' 个工件到工作台', 'success');
            } else if (done === 0) {
              renderError('投递全部失败：' + (firstErr || '未知错误') + '。请检查插件设置的「工作台投递目录」。');
            } else {
              renderError('投递完成：成功 ' + done + '，失败 ' + failed + '。' + (firstErr || ''));
            }
            return;
          }
          var path = paths[done + failed];
          apiWrite('/api/desk-deliver', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: PROJECT_ID, path: path }),
          })
            .then(function (res) {
              if (res && res.ok) done++;
              else {
                failed++;
                if (!firstErr) firstErr = (res && res.error) || ('失败: ' + path);
              }
              nextDeliver();
            })
            .catch(function (e) {
              failed++;
              if (!firstErr) firstErr = e.message || '未知错误';
              nextDeliver();
            });
        })();
      })
      .catch(function () { renderError('投递全部失败：工件列表读取失败'); });
  }

  function previewArtifact(path) {
    var body = $('previewBody');
    var title = $('previewTitle');
    var mask = $('previewMask');
    if (!body || !mask || !path) return;
    body.innerHTML = '<span class="ph">载入中…</span>';
    if (title) title.textContent = path.split('/').pop();
    mask.classList.add('open');
    animateModalOpen(mask);
    var ext = (path.split('.').pop() || '').toLowerCase();
    var params = '?projectId=' + encodeURIComponent(PROJECT_ID) + '&path=' + encodeURIComponent(path);
    var readUrl = API + '/api/artifact/read' + params;
    // <img>/<video> 直链无法设置请求头，凭证走 query（宿主两者皆收）；fetch 走 header
    var imgExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
    var videoExts = ['mp4', 'webm', 'mov', 'm4v'];
    if (imgExts.indexOf(ext) >= 0) {
      body.innerHTML = '<img src="' + withAuth(readUrl) + '" alt="' + esc(path) + '">';
    } else if (videoExts.indexOf(ext) >= 0) {
      body.innerHTML = '<video src="' + withAuth(readUrl) + '" controls></video>';
    } else {
      authFetch(readUrl)
        .then(function (r) { return r.text(); })
        .then(function (t) {
          body.innerHTML = '<pre>' + esc(t.slice(0, 20000)) + '</pre>';
        })
        .catch(function () { body.innerHTML = '<span class="err-text">预览失败</span>'; });
    }
  }

  function closePreview() {
    var mask = $('previewMask');
    if (mask) mask.classList.remove('open');
  }

  // ── 数据 ──
  function loadThread(agentId, silent) {
    if (!PROJECT_ID) return;
    var box = $('threadText');
    if (!silent && box) box.classList.add('thinking');
    authFetch(API + '/api/thread?projectId=' + encodeURIComponent(PROJECT_ID) + '&agentId=' + encodeURIComponent(agentId))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        // silent 轮询：失败或会话暂不可读时保留已有显示，不覆盖消息区（防“显示一下又消失”）
        if (silent && (!d.ok || !d.text)) return;
        if (!d.ok) { renderError(d.error || '加载失败', d.hint); return; }
        renderThread(d);
      })
      .catch(function (e) {
        if (!silent) renderError('请求失败: ' + e.message);
      });
  }

  function sendMessage() {
    if (busy) return;
    var input = $('msgInput');
    var text = input.value.trim();
    if (!text) return;
    busy = true;
    input.value = '';
    var btn = $('sendBtn');
    btn.disabled = true;
    btn.textContent = '发送中…';
    var box = $('threadText');
    // 乐观渲染：用户消息立即上屏，不等服务端往返，消除“发了没反应/闪动”的错觉
    if (box) {
      box.classList.remove('thinking');
      box.innerHTML = '<div class="ph" style="color:var(--ink);">我：' + esc(text) + '</div>' +
        '<div class="err-hint" style="margin-top:8px;">等待工位回复…</div>';
    }

    authFetch(API + '/api/thread/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: PROJECT_ID, agentId: currentAgent, text: text }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) { renderError(d.error || '发送失败', d.hint); }
        else if (d.rebuilt) { hostToast('工位会话已自动重建', 'success'); }
        else if (d.retried) { hostToast('宿主繁忙，消息已自动重试成功', 'info'); }
        busy = false;
        btn.disabled = false;
        btn.textContent = '发送';
        setTimeout(loadThread, 600, currentAgent, false);
      })
      .catch(function (e) {
        renderError('发送失败: ' + e.message);
        busy = false;
        btn.disabled = false;
        btn.textContent = '发送';
      });
  }

  function switchTab(agentId) {
    if (agentId === currentAgent) return;
    currentAgent = agentId;
    renderTabs();
    loadThread(agentId, false);
  }

  // ── 执行面板 ──
  function loadTasks() {
    if (!PROJECT_ID) return;
    authFetch(API + '/api/tasks?projectId=' + encodeURIComponent(PROJECT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) renderTasks(d.tasks || []);
      })
      .catch(function () { /* 静默 */ });
  }

  function renderTasks(tasks) {
    var box = $('execList');
    if (!box) return;
    if (!tasks.length) {
      box.innerHTML = '<div class="exec-empty">制作任务的执行状态将在这里呈现</div>';
      return;
    }
    box.innerHTML = tasks.map(function (t) {
      var cls = t.status === '完成' ? 'done' : t.status === '失败' ? 'err' : 'run';
    var bar = t.progress != null
        ? '<div class="prog"><div class="prog-fill" data-p="' + Math.max(0, Math.min(100, t.progress)) + '" style="width:' + Math.max(0, Math.min(100, t.progress)) + '%"></div></div>'
        : '';
      var hasDetail = (t.logSummary || (t.artifactPaths && t.artifactPaths.length));
      return '<div class="task-item" data-expand="0">' +
        '<div class="task-head">' +
        '<span class="task-id">' + esc(t.id || '') + '</span>' +
        '<span class="task-stage">' + esc(t.stageId || '') + '</span>' +
        '<span class="task-status ' + cls + '">' + esc(t.status || '') + '</span>' +
        (hasDetail ? '<span class="task-chev">▾</span>' : '') +
        '</div>' +
        bar +
        '<div class="task-detail" style="display:none;">' +
        (t.logSummary ? '<div class="task-log">' + esc(t.logSummary) + '</div>' : '') +
        (t.artifactPaths && t.artifactPaths.length ? '<div class="task-paths">产出：' + t.artifactPaths.map(esc).join(' · ') + '</div>' : '') +
        '</div>' +
        '</div>';
    }).join('');
    box.querySelectorAll('.task-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var detail = item.querySelector('.task-detail');
        var chev = item.querySelector('.task-chev');
        if (!detail) return;
        var open = item.getAttribute('data-expand') === '1';
        item.setAttribute('data-expand', open ? '0' : '1');
        detail.style.display = open ? 'none' : 'block';
        if (chev) chev.textContent = open ? '▾' : '▴';
      });
    });
    // 进度条首次出现时做流动动画（重复轮询不重放）
    box.querySelectorAll('.prog-fill').forEach(function (el) {
      if (el.getAttribute('data-animated')) return;
      el.setAttribute('data-animated', '1');
      animateBar(el);
    });
  }

  // ── 阶段详情（验收意见 + 工件）──
  function showStageDetail(stageId) {
    authFetch(API + '/api/project?projectId=' + encodeURIComponent(PROJECT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok || !d.project) return;
        var stage = (d.project.stages || []).find(function (s) { return s.stageId === stageId; });
        if (!stage) return;
        renderStageDetail(stage);
      })
      .catch(function () { /* 静默 */ });
  }

  function renderStageDetail(stage) {
    var body = $('previewBody');
    var title = $('previewTitle');
    var mask = $('previewMask');
    if (!body || !mask) return;
    if (title) title.textContent = stage.name + ' · ' + (stage.status || '');
    mask.classList.add('open');
    animateModalOpen(mask);

    var html = '';
    if (stage.review && stage.review.verdict) {
      var r = stage.review;
      html += '<div class="stage-review">' +
        '<div class="verdict ' + (r.verdict === '通过' ? 'pass' : 'reject') + '">' + esc(r.verdict) + '</div>' +
        (r.mustFix && r.mustFix.length ? '<div class="rv-item"><b>必修：</b>' + r.mustFix.map(esc).join('；') + '</div>' : '') +
        (r.suggestions && r.suggestions.length ? '<div class="rv-item"><b>建议：</b>' + r.suggestions.map(esc).join('；') + '</div>' : '') +
        (r.at ? '<div class="rv-time">' + esc(String(r.at).replace('T', ' ').slice(0, 19)) + '</div>' : '') +
        '</div>';
    } else {
      html += '<div class="ph">该阶段尚未验收</div>';
    }

    if (stage.artifacts && stage.artifacts.length) {
      html += '<div class="rv-artifacts"><div class="rv-title">阶段工件</div>' +
        stage.artifacts.map(function (a) {
          return '<div class="artifact-item" data-path="' + esc(a.path) + '" title="' + esc(a.title || a.path) + '">' +
            '<span class="artifact-type">' + esc(a.type) + '</span>' +
            '<span class="artifact-name">' + esc(a.title || a.path) + '</span>' +
            '<span class="artifact-ver">v' + esc(a.version) + '</span>' +
            '</div>';
        }).join('') + '</div>';
    } else {
      html += '<div class="ph">该阶段暂无工件</div>';
    }

    body.innerHTML = html;
    body.querySelectorAll('.artifact-item').forEach(function (item) {
      item.addEventListener('click', function () { previewArtifact(item.getAttribute('data-path')); });
    });
  }

  // ── 工位准备（第三层：一键创建/复用工位 Agent）──
  function setupStations() {
    var btn = $('btnStations');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '准备中…';
    apiWrite('/api/stations/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (d) {
        btn.disabled = false;
        btn.textContent = '准备工位';
        // 有明细就永远渲染明细（无论 ok 与否），让用户看到每个工位的具体状态
        if (d.results && d.results.length) {
          renderStationsResult(d.results);
        } else {
          renderError(d.error || '准备失败');
        }
      })
      .catch(function (e) {
        btn.disabled = false;
        btn.textContent = '准备工位';
        renderError('请求失败: ' + e.message);
      });
  }

  function renderStationsResult(results) {
    var box = $('threadText');
    if (!box) return;
    box.classList.remove('thinking');
    var ready = 0, created = 0, failed = 0;
    results.forEach(function (r) { if (r.status === 'ready') ready++; else if (r.status === 'created') created++; else failed++; });
    var summary = window.AGENTS.length + ' 个工位：' + ready + ' 复用 / ' + created + ' 新建 / ' + failed + ' 失败';
    var html = '<div class="err-hint" style="margin:0 0 10px;">' + esc(summary) + '</div>';
    results.forEach(function (r) {
      var mark = r.status === 'ready' ? '✓' : (r.status === 'created' ? '＋' : '✗');
      var info = r.status === 'ready' ? '已存在，直接复用' : (r.status === 'created' ? '已创建（插件私有，不出现在主列表）' : (r.error || '未知错误'));
      html += '<div class="err-hint" style="margin-bottom:6px;">' + esc(mark + ' ' + r.shortName + ' = ' + r.agentId + ' · ' + info) + '</div>';
    });
    box.innerHTML = html;
  }

  // ── 宿主 Plugin UI 协议客户端（零依赖手写，协议对齐 @hana/plugin-sdk）──
  // 请求格式：{ protocol:'hana.plugin.ui', version:1, id, kind:'request', type, payload } → parent.postMessage
  // 能力授权：manifest page.hostCapabilities 声明（如 resource.pick）
  var HOST_PROTOCOL = 'hana.plugin.ui';
  var HOST_VERSION = 1;
  var hostOrigin = (window.location && window.location.origin) || '';  // 缺省收紧为父窗口同源；优先 hana-host-origin，其次 referrer
  (function resolveHostOrigin() {
    try {
      var q = new URLSearchParams(window.location.search);
      var ho = q.get('hana-host-origin');
      if (ho) { hostOrigin = ho; return; }
      if (document.referrer) {
        var u = new URL(document.referrer);
        hostOrigin = u.origin;
      }
    } catch (e) { /* 保持缺省同源 */ }
  })();

  function pluginUiRequest(type, payload) {
    return new Promise(function (resolve, reject) {
      var id = 'r' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
      var timer = null;
      function onMsg(e) {
        if (e.source !== window.parent) return;
        if (hostOrigin !== '*' && e.origin !== hostOrigin) return;
        var d = e.data;
        if (!d || d.protocol !== HOST_PROTOCOL || d.id !== id) return;
        window.removeEventListener('message', onMsg);
        if (timer) clearTimeout(timer);
        if (d.kind === 'response') resolve(d.payload);
        else if (d.kind === 'error') reject(new Error((d.error && d.error.message) || '宿主能力调用失败'));
      }
      window.addEventListener('message', onMsg);
      timer = setTimeout(function () {
        window.removeEventListener('message', onMsg);
        reject(new Error('宿主响应超时（' + type + '）'));
      }, 10000);
      var msg = { protocol: HOST_PROTOCOL, version: HOST_VERSION, id: id, kind: 'request', type: type };
      if (payload !== undefined) msg.payload = payload;
      try {
        window.parent.postMessage(msg, hostOrigin);
      } catch (e) {
        window.removeEventListener('message', onMsg);
        if (timer) clearTimeout(timer);
        reject(e);
      }
    });
  }

  // 系统文件夹选择器：返回绝对路径（宿主 resource.pick mode=directory）
  function pickFolder() {
    return pluginUiRequest('resource.pick', { mode: 'directory' }).then(function (res) {
      var list = res && res.resources;
      if (list && list.length && list[0] && list[0].path) return String(list[0].path);
      return '';
    });
  }

  // 宿主 toast 提示（requiresGrant: false，页面可直接用）
  function hostToast(message, type) {
    return pluginUiRequest('toast.show', { message: String(message), type: type || 'info', duration: 5000 }).catch(function () {});
  }

  // ── 文件导入（页面按钮 → base64 → /api/import → 项目工作台）──
  function bindImport() {
    var btn = $('btnImport');
    var input = $('importInput');
    if (btn && input) {
      btn.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        var files = Array.prototype.slice.call(input.files || []);
        input.value = '';
        if (!PROJECT_ID || !files.length) return;
        uploadFiles(files, false);
      });
    }
    // 文件夹整体导入（webkitdirectory，按相对结构存放）
    var dirBtn = $('btnImportDir');
    var dirInput = $('importDirInput');
    if (dirBtn && dirInput) {
      dirBtn.addEventListener('click', function () { dirInput.click(); });
      dirInput.addEventListener('change', function () {
        var files = Array.prototype.slice.call(dirInput.files || []);
        dirInput.value = '';
        if (!PROJECT_ID || !files.length) return;
        uploadFiles(files, true);
      });
    }
  }

  function guessType(name) {
    var ext = String(name || '').toLowerCase().split('.').pop();
    if (['mp4', 'webm', 'mov', 'mkv', 'avi', 'flv'].indexOf(ext) >= 0) return 'video';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].indexOf(ext) >= 0) return 'image';
    if (['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'].indexOf(ext) >= 0) return 'audio';
    if (['md', 'txt'].indexOf(ext) >= 0) return 'script';
    return 'asset';
  }

  function uploadFiles(files, dirMode) {
    var btn = $('btnImport');
    var complete = 0;
    var total = files.length;
    function next() {
      complete++;
      if (complete > total) { if (btn) btn.textContent = '导入文件'; loadArtifacts(); return; }
      var f = files[complete - 1];
      if (btn) btn.textContent = '导入 ' + complete + '/' + total + ' ' + f.name + '…';
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = String(reader.result || '');
        var comma = dataUrl.indexOf(',');
        var dataBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
        // 目录模式：保留相对子路径（webkitRelativePath 如 素材夹/子目录/a.mp4）
        var relName = dirMode && f.webkitRelativePath ? f.webkitRelativePath : f.name;
        apiWrite('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: PROJECT_ID, name: relName, dataBase64: dataBase64, type: guessType(f.name) }),
        })
          .then(function (d) {
            if (!d.ok) {
              renderError(d.error || ('导入失败: ' + f.name));
            }
            next();
          })
          .catch(function (e) {
            renderError('导入失败: ' + e.message);
            next();
          });
      };
      reader.onerror = function () { renderError('读取文件失败: ' + f.name); next(); };
      reader.readAsDataURL(f);
    }
    if ($('threadText')) $('threadText').innerHTML = '<span class="ph">正在导入 ' + total + ' 个文件到工作台…</span>';
    next();
  }

  // ── 项目卡片弹层（点「项目」弹出卡片面板）──
  function renderProjectPop() {
    var pop = $('projectPop');
    if (!pop) return;
    var list = window.PROJECTS || [];
    if (!list.length) {
      pop.innerHTML = '<div class="ph" style="padding:12px;">暂无项目，先新建一个吧</div>';
      return;
    }
    pop.innerHTML = list.map(function (p) {
      var on = p.id === PROJECT_ID ? ' on' : '';
      return '<button class="project-card' + on + '" data-id="' + esc(p.id) + '" role="menuitem">' +
        '<div class="project-card-title">' + esc(p.title || '未命名') + '</div>' +
        '<div class="project-card-meta"><span class="dot' + (p.id === PROJECT_ID ? ' active' : '') + '"></span>' +
        esc(p.pipelineId || 'generic') + ' · 更新于 ' + esc((p.updatedAt || '').slice(0, 10)) + '</div>' +
        '</button>';
    }).join('');
    pop.querySelectorAll('.project-card').forEach(function (card) {
      card.addEventListener('click', function () { gotoProject(card.getAttribute('data-id')); });
    });
  }

  function toggleProjectPop() {
    var pop = $('projectPop');
    var btn = $('projectSelectBtn');
    if (!pop) return;
    var open = pop.classList.toggle('open');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      renderProjectPop();
      if (gsapSafe()) {
        window.gsap.fromTo(pop, { autoAlpha: 0, y: -6, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.24, ease: 'power2.out' });
      }
    }
  }

  function bindWorkdirPicker() {
    // 新建项目表单：选择… → 系统文件夹选择器 → 自动填入路径
    var pickBtn = $('npPickDir');
    if (pickBtn) {
      pickBtn.addEventListener('click', function () {
        pickBtn.disabled = true;
        pickBtn.textContent = '选择中…';
        pickFolder()
          .then(function (p) {
            if (p && $('npWorkDir')) $('npWorkDir').value = p;
          })
          .catch(function (e) { hostToast(e.message || '选择文件夹失败', 'error'); })
          .finally(function () {
            pickBtn.disabled = false;
            pickBtn.textContent = '选择…';
          });
      });
    }
    // 已有项目：更换工作台 → 选择后写入
    var changeBtn = $('btnChangeWorkdir');
    if (changeBtn) {
      changeBtn.addEventListener('click', function () {
        changeBtn.disabled = true;
        changeBtn.textContent = '选择中…';
        pickFolder()
          .then(function (p) {
            if (!p) { hostToast('未选择文件夹', 'info'); return; }
            return apiWrite('/api/project/workdir', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectId: PROJECT_ID, workDir: p }),
            }).then(function (d) {
              if (d.ok) {
                hostToast('工作台已更换：' + p, 'success');
                setTimeout(function () { location.reload(); }, 600);
              } else {
                hostToast(d.error || '更换失败', 'error');
              }
            });
          })
          .catch(function (e) { hostToast(e.message || '选择文件夹失败', 'error'); })
          .finally(function () {
            changeBtn.disabled = false;
            changeBtn.textContent = '更换工作台';
          });
      });
    }
  }

  // ── 新建项目 ──
  function loadPipelines() {
    authFetch(API + '/api/pipelines')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok || !d.pipelines || !d.pipelines.length) return;
        var sel = $('npPipeline');
        if (!sel) return;
        var opts = '<option value="generic">generic · 通用（默认工序）</option>';
        d.pipelines.forEach(function (p) {
          opts += '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>';
        });
        sel.innerHTML = opts;
      })
      .catch(function () { /* 保持默认 */ });
  }

  function openNewProject() {
    $('modalMask').classList.add('open');
    animateModalOpen($('modalMask'));
    $('npTitle').focus();
  }
  function closeNewProject() {
    $('modalMask').classList.remove('open');
  }
  function submitNewProject() {
    var title = $('npTitle').value.trim();
    if (!title) { $('npTitle').focus(); return; }
    var btn = $('npSubmit');
    btn.disabled = true;
    btn.textContent = '创建中…';
    var reqPath = '/api/project';
    apiWrite(reqPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title,
        brief: $('npBrief').value.trim(),
        pipelineId: $('npPipeline').value,
        workDir: ($('npWorkDir') ? $('npWorkDir').value.trim() : ''),
      }),
    })
      .then(function (d) {
        if (d.ok && d.project && d.project.id) {
          gotoProject(d.project.id);
        } else {
          // 诊断：只打印错误文本与 HTTP 状态，不打印含凭证的 URL / location / cookie
          alertInline(
            (d.error || (d._fetchError ? '网络错误: ' + d._fetchError : '创建失败')) +
            (d.httpStatus ? '（HTTP ' + d.httpStatus + '）' : '')
          );
          btn.disabled = false;
          btn.textContent = '创建项目';
        }
      });
  }

  function alertInline(msg) {
    var t = $('threadText');
    if (t) t.innerHTML = '<span class="err-text">' + esc(msg) + '</span>';
  }

  // 跳转只保留 pluginSurfaceSession + projectId，丢弃 pluginIframeTicket：
  // ticket 只用于首次加载；跳转后继续带 ticket 会把 projectId 拼进 surfacePath 导致 route mismatch 403；
  // 无 ticket 时页面走 pluginSurfaceSession 鉴权（Ktt）正常渲染。
  function gotoProject(id) {
    try {
      var params = new URLSearchParams(window.location.search);
      var keep = new URLSearchParams();
      var ss = params.get('pluginSurfaceSession');
      if (ss) keep.set('pluginSurfaceSession', ss);
      keep.set('projectId', id);
      location.search = keep.toString();
    } catch (e) {
      location.href = '?projectId=' + encodeURIComponent(id);
    }
  }

  // ── 启动 ──
  function init() {
    // 环境诊断（仅当 URL 带 OMSTUDIO_DEBUG=1 时显示；不打印 cookie 明文与整段 location.search）
    try {
      var dbg = new URLSearchParams(window.location.search).get('OMSTUDIO_DEBUG');
      if (dbg === '1') {
        var diagEl = document.createElement('div');
        diagEl.id = 'envDiag';
        diagEl.style.cssText = 'font-size:11px;line-height:1.5;color:#8a7f6f;background:#f2eee4;border-bottom:1px dashed #d8cfc0;padding:4px 14px;font-family:monospace;word-break:break-all;';
        diagEl.textContent = 'ENV | hana: ' + (window.hana ? '有' : '无') + ' | path: ' + window.location.pathname + ' | session: ' + (surfaceSession() ? '有' : '无');
        document.body.insertBefore(diagEl, document.body.firstChild);
      }
    } catch (e) { /* 诊断失败不影响 */ }
    renderTabs();
    loadPipelines();
    var btn = $('btnNewProject');
    if (btn) btn.addEventListener('click', openNewProject);
    var stBtn = $('btnStations');
    if (stBtn) stBtn.addEventListener('click', setupStations);
    bindImport();
    bindWorkdirPicker();
    // 工件库：投递全部
    var deliverAllBtn = $('btnDeliverAll');
    if (deliverAllBtn) deliverAllBtn.addEventListener('click', deliverAll);
    // 项目卡片弹层：按钮开关 + 点击外部关闭
    var selectBtn = $('projectSelectBtn');
    if (selectBtn) {
      selectBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleProjectPop(); });
    }
    document.addEventListener('click', function (e) {
      var pop = $('projectPop');
      var btn = $('projectSelectBtn');
      if (pop && pop.classList.contains('open') && !e.target.closest('.project-picker')) {
        pop.classList.remove('open');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }
    });
    var cancel = $('npCancel');
    if (cancel) cancel.addEventListener('click', closeNewProject);
    var submit = $('npSubmit');
    if (submit) submit.addEventListener('click', submitNewProject);
    var mask = $('modalMask');
    if (mask) mask.addEventListener('click', function (e) { if (e.target === mask) closeNewProject(); });
    var pClose = $('previewClose');
    if (pClose) pClose.addEventListener('click', closePreview);
    var pMask = $('previewMask');
    if (pMask) pMask.addEventListener('click', function (e) { if (e.target === pMask) closePreview(); });
    // 工序卡点击 → 阶段详情
    document.addEventListener('click', function (e) {
      var f = e.target.closest ? e.target.closest('.frame') : null;
      if (f && PROJECT_ID) showStageDetail(f.getAttribute('data-stage'));
    });
    if (PROJECT_ID) {
      loadThread(currentAgent, false);
      loadArtifacts();
      loadTasks();
      pollTimer = setInterval(function () { loadThread(currentAgent, true); loadArtifacts(); loadTasks(); }, 8000);
    } else {
      renderError('未选择项目');
    }
    var sendBtn = $('sendBtn');
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    var input = $('msgInput');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
      });
      input.addEventListener('input', function () {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); animateFilmstrip(); });
  } else {
    init();
    animateFilmstrip();
  }
})();
