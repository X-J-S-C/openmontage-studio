// OpenMontage Studio - 页面路由 (T6 重写版)
// 服务端渲染：项目选择器 + 胶片帧带工序条 + 工位对话 + 工件库 + 执行面板
// 视觉：Editorial Luxury 纸感路线（暖纸白 / 暖铜 / 墨色），与 Hana 界面一致
// route 逻辑保留：管线动态读取、项目选择、PROJECT_ID 注入、app.js 内嵌

import { loadIndex, loadProject, saveProject, DEFAULT_STAGES } from '../lib/store.js';
import { loadPipelineStages } from '../lib/pipelines.js';
import { registerApiRoutes } from './api.js';
import { getConfig, agentList } from '../lib/config.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, '..', 'assets');

function loadAppJs() {
  try {
    return readFileSync(join(ASSETS_DIR, 'app.js'), 'utf-8').replace(/<\/script>/gi, '<\\/script>');
  } catch (e) {
    return 'console.error(' + JSON.stringify('app.js 加载失败: ' + e.message) + ');';
  }
}

// 本地打包的 GSAP 核心库（Webflow 收购后 100% 免费，含商业使用）
// 离线可用、不依赖 CDN，页面通过相对路径 ./gsap.min.js 引用
const GSAP_JS = readFileSync(join(ASSETS_DIR, 'vendor', 'gsap.min.js'), 'utf-8');

function loadSidebarJs() {
  try {
    return readFileSync(join(ASSETS_DIR, 'sidebar.js'), 'utf-8').replace(/<\/script>/gi, '<\\/script>');
  } catch (e) {
    return '';
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

// 内联 <script> JSON 注入安全化：把 < 与 U+2028/U+2029 转义为 JSON 字面转义序列，
// 防止数据中的 </script> 提前闭合标签造成存储型 XSS
function jsSafe(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// 最小安全响应头：统一加在页面/静态资源响应上
function secHeaders(extra) {
  return Object.assign({}, extra || {}, {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
}

const STATUS_LABEL = { '待料': '待料', '进行中': '进行中', '待验': '待验', '已交付': '已交付' };

function renderFilmStrip(stages, currentStageId) {
  const items = (stages || []).map((s) => {
    const isCurrent = s.stageId === currentStageId;
    const status = STATUS_LABEL[s.status] || '待料';
    const cls = ['frame', isCurrent ? 'current' : '', 'st-' + (s.status === '已交付' ? 'done' : s.status === '待验' ? 'ready' : s.status === '进行中' ? 'active' : 'pending')]
      .filter(Boolean).join(' ');
    const reviewMark = s.review && s.review.verdict
      ? `<div class="frame-review ${s.review.verdict === '通过' ? 'pass' : 'reject'}">${s.review.verdict === '通过' ? '✓' : '↺'}</div>`
      : '';
    return `
      <div class="frame ${cls}" data-stage="${esc(s.stageId)}" title="${esc(s.name)} · ${esc(status)}（点击查看验收详情）">
        <div class="frame-dot"></div>
        <div class="frame-name">${esc(s.name)}</div>
        <div class="frame-status">${esc(status)}</div>
        ${reviewMark}
      </div>`;
  }).join('');
  return `<div class="filmstrip" role="list" aria-label="工序进度">${items}</div>`;
}

export default function registerRoutes(app, ctx) {
  // onError：精简错误信息（发布版不暴露堆栈）
  try {
    app.onError((err, c) => {
      try {
        return new Response(JSON.stringify({ error: err && err.message ? err.message : '内部错误' }), {
          status: 500,
          headers: secHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
        });
      } catch (e2) {
        return new Response('internal-error', { status: 500, headers: secHeaders({}) });
      }
    });
  } catch (e) { /* onError 注册失败不影响 */ }

  // GSAP 静态资源（服务端渲染页面经由相对路径引用）
  app.get('/montage/gsap.min.js', (c) => {
    return new Response(GSAP_JS, {
      headers: secHeaders({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }),
    });
  });

  // Widget：侧边栏工作台（Hana Jian 侧栏）——聚合各项目工件，点击用宿主打开预览
  app.get('/sidebar', async (c) => {
    const pluginCtx = c.get('pluginCtx') || ctx || {};
    const dataDir = pluginCtx.dataDir || '';
    const indexData = dataDir ? loadIndex(dataDir) : { projects: [] };
    const projects = (indexData.projects || []).slice(0, 5);

    const groups = [];
    for (const p of projects) {
      const project = loadProject(dataDir, p.id);
      if (!project) continue;
      const root = project.workDir ? project.workDir : join(dataDir, 'projects', project.id);
      const items = [];
      for (const st of project.stages || []) {
        for (const a of st.artifacts || []) {
          items.push({
            title: a.title || String(a.path || '').split('/').pop(),
            type: a.type || 'asset',
            path: join(root, a.path || ''),
            stage: st.name || st.stageId || '',
            version: a.version || 1,
          });
        }
      }
      items.sort((x, y) => String(y.stage).localeCompare(String(x.stage)));
      groups.push({ id: project.id, title: project.title, pipelineId: project.pipelineId || 'generic', items });
    }

    const groupHtml = groups.map((g) => {
      const list = g.items.length
        ? g.items.map((it) =>
            `<div class="om-item" data-open="${esc(it.path)}" title="${esc(it.title)} · ${esc(it.path)}">` +
            `<span class="om-type">${esc(it.type)}</span>` +
            `<span class="om-name">${esc(it.title)}</span>` +
            `<span class="om-stage">${esc(it.stage)}</span>` +
            `</div>`
          ).join('')
        : '<div class="om-empty">暂无工件</div>';
      return (
        `<div class="om-group">` +
        `<div class="om-gt"><b>${esc(g.title)}</b><span>${esc(g.pipelineId)}</span></div>` +
        list +
        `</div>`
      );
    }).join('');

    const body = groups.length
      ? groupHtml
      : '<div class="om-empty">还没有视频项目<br>去「视频工坊」创建第一个吧</div>';

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenMontage 工作台</title>
<style>
  body { margin: 0; font-family: "Segoe UI", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: transparent; color: #26221c; font-size: 12px; }
  .om-w { padding: 10px 12px 14px; }
  .om-w h3 { font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: #a49c8d; margin: 0 0 9px; font-weight: 600; }
  .om-empty { color: #a49c8d; font-size: 11px; line-height: 1.7; padding: 6px 0; }
  .om-group { margin-bottom: 11px; }
  .om-gt { font-size: 10px; color: #a49c8d; letter-spacing: 0.08em; border-bottom: 1px dashed #e4ddd0; padding-bottom: 3px; margin-bottom: 5px; display: flex; gap: 8px; align-items: baseline; }
  .om-gt b { color: #6f6759; font-weight: 600; }
  .om-item { display: flex; align-items: center; gap: 7px; padding: 5px 7px; border-radius: 8px; cursor: pointer; transition: background 0.2s; }
  .om-item:hover { background: #f0e3d2; }
  .om-type { font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; background: #efe9de; border-radius: 4px; padding: 1px 6px; color: #6f6759; flex: none; }
  .om-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #26221c; }
  .om-stage { font-size: 10px; color: #a49c8d; flex: none; }
</style>
</head>
<body>
<div class="om-w">
  <h3>OpenMontage · 工作台</h3>
  ${body}
</div>
<script>${loadSidebarJs()}</script>
</body>
</html>`;

    return new Response(html, {
      headers: secHeaders({ 'Content-Type': 'text/html; charset=utf-8' }),
    });
  });
  app.get('/montage', async (c) => {
    const url = new URL(c.req.url);
    const css = url.searchParams.get('hana-css') ?? '';
    const themeLink = css ? `<link rel="stylesheet" href="${esc(css)}">` : '';

    const pluginCtx = c.get('pluginCtx') || ctx || {};
    const dataDir = pluginCtx.dataDir || '';
    const indexData = dataDir ? loadIndex(dataDir) : { projects: [] };
    const projects = indexData.projects || [];

    const selectedId = url.searchParams.get('projectId') || (projects[0] && projects[0].id) || '';
    const project = selectedId ? loadProject(dataDir, selectedId) : null;

    // 用户配置：仓库路径 + 工位 agent（注入前端 tab 用）
    const pluginCfg = await getConfig(pluginCtx);
    const agents = agentList(pluginCfg.agents).map((a) => ({ id: a.id, name: a.name }));

    let stages = project ? project.stages : DEFAULT_STAGES;
    let pipelineNote = '';
    let repoError = '';
    const repoPath = pluginCfg.repoPath;
    if (project && project.pipelineId) {
      if (repoPath) {
        try {
          if (pluginCtx.resources && typeof pluginCtx.resources.read === 'function') {
            const pipelineStages = await loadPipelineStages(pluginCtx.resources, repoPath, project.pipelineId, pluginCfg.agents);
            const existing = project.stages || [];
            const merged = pipelineStages.map((sd) => {
              const ex = existing.find((s) => s.stageId === sd.stageId);
              return ex
                ? { ...sd, status: ex.status, artifacts: ex.artifacts || [], review: ex.review || null, rejectStreak: ex.rejectStreak || 0 }
                : { ...sd, status: '待料', artifacts: [], review: null };
            });
            if (merged.length > 0) {
              project.stages = merged;
              if (!merged.find((s) => s.stageId === project.currentStageId)) {
                project.currentStageId = merged[0].stageId;
              }
              const cur = project.stages.find((s) => s.stageId === project.currentStageId);
              if (cur && cur.status === '待料') cur.status = '进行中';
              // 持久化重建后的阶段（避免刷新后状态丢失）
              try { saveProject(dataDir, project); } catch { /* 保存失败不阻断渲染 */ }
            }
            stages = project.stages;
            pipelineNote = project.pipelineId + ' · ' + stages.length + ' 道工序';
          } else {
            repoError = '资源通道不可用';
          }
        } catch (e) {
          repoError = e && e.message ? e.message : String(e);
        }
      } else {
        pipelineNote = '默认工序';
      }
    }

    const hasProject = !!project;

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenMontage Studio</title>
${themeLink}
<style>
  :root {
    --bg: #f6f3ec;
    --surface: #fdfcf8;
    --surface-deep: #efe9de;
    --ink: #26221c;
    --ink-dim: #6f6759;
    --ink-faint: #a49c8d;
    --line: #e4ddd0;
    --line-strong: #d4cbb9;
    --accent: #b0763a;
    --accent-soft: #f0e3d2;
    --ok: #6f8f5f;
    --warn: #c99a4e;
    --err: #b05f52;
    --radius-lg: 20px;
    --radius-md: 14px;
    --radius-sm: 9px;
    --shadow-soft: 0 1px 2px rgba(38, 34, 28, 0.04), 0 4px 16px rgba(38, 34, 28, 0.05);
    --ease: cubic-bezier(0.32, 0.72, 0, 1);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-font-smoothing: antialiased; }
  body {
    background: var(--bg);
    color: var(--ink);
    font-family: "Geist", "Segoe UI", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 14px; line-height: 1.6;
    padding: 20px 22px 26px; min-height: 100vh;
  }
  @media (max-width: 720px) { body { padding: 12px 14px 18px; } }

  /* ── 顶栏 ── */
  .topbar { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; flex-wrap: wrap; }
  .brand { display: flex; align-items: baseline; gap: 8px; }
  .brand-name {
    font-family: "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif;
    font-size: 16px; font-weight: 600; letter-spacing: 0.04em;
  }
  .brand-sub { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-faint); }
  .spacer { flex: 1; }
  .pipeline-badge {
    font-size: 11px; color: var(--ink-dim); background: var(--surface);
    border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px;
  }
  .pipeline-badge.err { color: var(--err); border-color: #e0b5ac; background: #faf0ee; }

  /* 项目卡选择器（点一下弹出卡片面板） */
  .project-picker { position: relative; }
  .project-picker-btn {
    appearance: none; display: inline-flex; align-items: center; gap: 7px;
    background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--radius-sm);
    color: var(--ink); font-size: 13px; font-family: inherit;
    padding: 7px 30px 7px 13px; max-width: 300px; cursor: pointer;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%236f6759' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 12px center;
    transition: border-color 0.25s var(--ease), box-shadow 0.25s var(--ease);
  }
  .project-picker-btn:hover { border-color: var(--accent); }
  .project-picker-btn:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .project-pop {
    position: absolute; top: calc(100% + 8px); right: 0; z-index: 60;
    width: min(340px, calc(100vw - 48px)); max-height: 58vh; overflow-y: auto;
    background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
    box-shadow: 0 16px 48px rgba(38, 34, 28, 0.18); padding: 8px;
    display: none;
  }
  .project-pop.open { display: block; }
  .project-card {
    display: block; width: 100%; text-align: left;
    background: transparent; border: 1px solid transparent; border-radius: 12px;
    padding: 10px 12px; cursor: pointer; margin-bottom: 4px; font-family: inherit;
    transition: background 0.22s var(--ease), border-color 0.22s var(--ease), transform 0.22s var(--ease), box-shadow 0.22s var(--ease);
  }
  .project-card:hover {
    background: var(--accent-soft); border-color: rgba(176, 118, 58, 0.28);
    transform: translateY(-1px); box-shadow: 0 4px 14px rgba(38, 34, 28, 0.08);
  }
  .project-card.on { background: var(--accent-soft); border-color: var(--accent); }
  .project-card-title { font-size: 13px; font-weight: 600; color: var(--ink); }
  .project-card-meta { font-size: 11px; color: var(--ink-faint); margin-top: 3px; display: flex; gap: 8px; align-items: center; }
  .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; background: var(--line-strong); }
  .dot.done { background: var(--ok); }
  .dot.active { background: var(--accent); }

  .btn-new {
    appearance: none; border: 1px solid var(--accent); background: transparent; color: var(--accent);
    border-radius: var(--radius-sm); padding: 7px 14px; font-size: 12.5px; font-weight: 600; font-family: inherit;
    cursor: pointer; transition: all 0.25s var(--ease);
  }
  .btn-new:hover { background: var(--accent-soft); }
  .btn-new:active { transform: scale(0.98); }

  /* 新建项目模态 */
  .modal-mask {
    position: fixed; inset: 0; background: rgba(38, 34, 28, 0.4); backdrop-filter: blur(3px);
    display: none; align-items: center; justify-content: center; z-index: 40;
  }
  .modal-mask.open { display: flex; }
  .modal {
    width: min(460px, calc(100vw - 40px)); background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--radius-lg); box-shadow: 0 12px 48px rgba(38, 34, 28, 0.18); padding: 20px 22px;
  }
  .modal h3 {
    font-family: "Noto Serif SC", "Songti SC", serif; font-size: 15px; font-weight: 600; margin-bottom: 4px;
  }
  .modal .sub { font-size: 11.5px; color: var(--ink-faint); margin-bottom: 16px; }
  .field { margin-bottom: 12px; }
  .field label { display: block; font-size: 11px; color: var(--ink-dim); letter-spacing: 0.08em; margin-bottom: 5px; }
  .field input, .field select, .field textarea {
    width: 100%; background: var(--surface); color: var(--ink); border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm); padding: 8px 11px; font-size: 13px; font-family: inherit;
    transition: border-color 0.25s var(--ease), box-shadow 0.25s var(--ease);
  }
  .field textarea { resize: vertical; min-height: 64px; }
  .field input:focus, .field select:focus, .field textarea:focus {
    outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  .modal-wide { width: min(780px, calc(100vw - 40px)); }
  .modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .modal-head h3 { font-family: "Noto Serif SC", "Songti SC", serif; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .modal-body { max-height: 60vh; overflow-y: auto; }
  .modal-body pre {
    white-space: pre-wrap; word-break: break-word; font-size: 12.5px; line-height: 1.7;
    font-family: inherit; color: var(--ink-dim); background: var(--surface-deep);
    border-radius: var(--radius-sm); padding: 12px 14px;
  }
  .modal-body img, .modal-body video { max-width: 100%; border-radius: var(--radius-sm); }
  .modal-body .err-text { color: var(--err); font-size: 12.5px; }
  .stage-review { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 10px 12px; margin-bottom: 12px; font-size: 12.5px; }
  .stage-review .verdict { font-weight: 700; margin-bottom: 6px; }
  .stage-review .verdict.pass { color: var(--ok); }
  .stage-review .verdict.reject { color: var(--err); }
  .stage-review .rv-item { margin-bottom: 4px; color: var(--ink-dim); line-height: 1.6; }
  .stage-review .rv-item b { color: var(--ink); font-weight: 600; }
  .stage-review .rv-time { font-size: 10.5px; color: var(--ink-faint); margin-top: 6px; }
  .rv-artifacts { margin-top: 4px; }
  .rv-title {
    font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-faint);
    margin-bottom: 6px; padding-bottom: 3px; border-bottom: 1px dashed var(--line);
  }
  .rv-artifacts .artifact-item { margin-bottom: 5px; }
  .btn-plain {
    appearance: none; border: 1px solid var(--line-strong); background: transparent; color: var(--ink-dim);
    border-radius: var(--radius-sm); padding: 7px 14px; font-size: 12.5px; font-family: inherit; cursor: pointer;
  }
  .btn-plain:hover { border-color: var(--accent); color: var(--accent); }
  .btn-primary {
    appearance: none; border: none; background: var(--accent); color: #fffdf8;
    border-radius: var(--radius-sm); padding: 7px 18px; font-size: 12.5px; font-weight: 600; font-family: inherit;
    cursor: pointer; transition: background 0.25s var(--ease), transform 0.15s var(--ease);
  }
  .btn-primary:hover { background: #9c6633; }
  .btn-primary:active { transform: scale(0.98); }
  .btn-primary:disabled { opacity: 0.5; cursor: default; }

  /* ── 胶片帧带工序条（签名元素） ── */
  .filmstrip {
    display: flex; align-items: stretch; gap: 0;
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--radius-lg); padding: 10px 12px;
    box-shadow: var(--shadow-soft); overflow-x: auto; margin-bottom: 14px;
  }
  .frame {
    position: relative; flex: 1 0 auto; min-width: 86px;
    padding: 10px 14px 9px; text-align: center;
    transition: background 0.3s var(--ease);
  }
  .frame + .frame::before {
    content: ""; position: absolute; left: -1px; top: 22px; width: 2px; height: 26px;
    background: var(--line); border-radius: 1px;
  }
  .frame-dot {
    width: 7px; height: 7px; border-radius: 50%; margin: 0 auto 6px;
    background: #d8d1c4; transition: background 0.3s var(--ease), box-shadow 0.3s var(--ease);
  }
  .frame-name { font-size: 12.5px; font-weight: 500; color: var(--ink-dim); white-space: nowrap; }
  .frame-status { font-size: 10.5px; color: var(--ink-faint); margin-top: 2px; letter-spacing: 0.04em; }
  .frame:hover { background: rgba(176, 118, 58, 0.05); transform: translateY(-1px); }
  .frame { transition: background 0.25s var(--ease), transform 0.25s var(--ease); }
  .frame.current { background: var(--accent-soft); border-radius: var(--radius-md); }
  .frame.current .frame-name { color: var(--accent); font-weight: 600; }
  .frame.st-active .frame-dot { background: var(--accent); box-shadow: 0 0 0 4px rgba(176, 118, 58, 0.15); }
  .frame.st-ready .frame-dot { background: var(--warn); }
  .frame.st-done .frame-dot { background: var(--ok); }
  .frame.st-done .frame-status { color: var(--ok); }
  .frame.st-ready .frame-status { color: var(--warn); }
  .frame.st-active .frame-status { color: var(--accent); }
  .frame-review {
    position: absolute; top: 6px; right: 8px; width: 16px; height: 16px;
    border-radius: 50%; font-size: 10px; line-height: 16px; text-align: center;
  }
  .frame-review.pass { background: rgba(111, 143, 95, 0.15); color: var(--ok); }
  .frame-review.reject { background: rgba(176, 95, 82, 0.15); color: var(--err); }

  /* ── 项目信息 ── */
  .project-head { display: flex; align-items: center; gap: 10px; margin: 0 2px 14px; flex-wrap: wrap; }
  .project-title {
    font-family: "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif;
    font-size: 17px; font-weight: 600; letter-spacing: 0.02em;
  }
  .project-brief { font-size: 12.5px; color: var(--ink-dim); }
  .project-audience {
    font-size: 11px; color: var(--ink-faint); border: 1px solid var(--line);
    border-radius: 999px; padding: 2px 10px;
  }
  .verdict-tag {
    font-size: 11px; color: var(--err); background: #faf0ee;
    border: 1px solid #e0b5ac; border-radius: 999px; padding: 3px 11px;
  }

  /* ── 主体 bento ── */
  .main { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 14px; margin-bottom: 14px; }
  @media (max-width: 860px) { .main { grid-template-columns: 1fr; } }

  .card {
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg);
    box-shadow: var(--shadow-soft); overflow: hidden;
  }
  .card-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 13px 16px 0;
  }
  .card-title {
    font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--ink-faint);
  }
  .card-body { padding: 12px 16px 16px; }

  /* 工位 tabs */
  .tabs { display: flex; gap: 6px; }
  .tab {
    appearance: none; border: 1px solid transparent; cursor: pointer;
    background: transparent; color: var(--ink-dim);
    font-size: 12.5px; font-family: inherit; padding: 5px 14px;
    border-radius: 999px; transition: all 0.25s var(--ease);
  }
  .tab:hover { color: var(--accent); }
  .tab.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }

  .thread-meta { font-size: 11px; color: var(--ink-faint); margin: 8px 0 6px; }
  .thread {
    min-height: 300px; max-height: 420px; overflow-y: auto;
    background: var(--surface-deep); border: 1px solid var(--line);
    border-radius: var(--radius-md); padding: 14px 16px;
    font-size: 13px; line-height: 1.75; word-break: break-word;
  }
  .thread .ph { color: var(--ink-faint); font-size: 12.5px; }
  .thread .err-text { color: var(--err); }
  .thread .err-hint {
    margin-top: 8px; font-size: 12px; color: var(--ink-dim);
    background: var(--surface); border: 1px dashed var(--line-strong);
    border-radius: 8px; padding: 8px 10px; line-height: 1.6;
  }
  .thread.thinking { opacity: 0.6; }

  .composer { display: flex; gap: 8px; margin-top: 10px; align-items: flex-end; }
  #msgInput {
    flex: 1; resize: none; font-family: inherit; font-size: 13px; line-height: 1.5;
    background: var(--surface); color: var(--ink); border: 1px solid var(--line-strong);
    border-radius: var(--radius-md); padding: 9px 13px;
    transition: border-color 0.25s var(--ease), box-shadow 0.25s var(--ease);
  }
  #msgInput::placeholder { color: var(--ink-faint); }
  #msgInput:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  #sendBtn {
    appearance: none; border: none; cursor: pointer;
    background: var(--accent); color: #fffdf8;
    font-size: 13px; font-weight: 600; font-family: inherit;
    border-radius: var(--radius-md); padding: 9px 20px;
    transition: background 0.25s var(--ease), transform 0.15s var(--ease);
  }
  #sendBtn:hover { background: #9c6633; }
  #sendBtn:active { transform: scale(0.98); }
  #sendBtn:disabled { opacity: 0.5; cursor: default; }

  /* 工件库 */
  .artifact-list { display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 240px); overflow-y: auto; padding-right: 2px; }
  .artifact-empty {
    border: 1px dashed var(--line-strong); border-radius: var(--radius-md);
    padding: 26px 16px; text-align: center; color: var(--ink-faint); font-size: 12px;
  }
  .artifact-item {
    display: flex; align-items: center; gap: 10px;
    border: 1px solid var(--line); border-radius: var(--radius-sm);
    padding: 8px 11px; font-size: 12.5px; cursor: pointer;
    transition: border-color 0.25s var(--ease), background 0.25s var(--ease);
  }
  .artifact-item:hover { border-color: var(--accent); background: var(--accent-soft); transform: translateY(-1px); box-shadow: 0 3px 10px rgba(38, 34, 28, 0.07); }
  .artifact-type {
    font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
    background: var(--surface-deep); border-radius: 5px; padding: 2px 7px; color: var(--ink-dim);
  }
  .artifact-name { flex: 1; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .artifact-ver { font-size: 11px; color: var(--ink-faint); }
  .artifact-stage { font-size: 10px; color: var(--ink-faint); }
  .deliver-btn { font-size: 12px; color: var(--ink-faint); padding: 0 5px; cursor: pointer; border-radius: 5px; flex: none; transition: all 0.2s var(--ease); }
  .deliver-btn:hover { color: var(--accent); background: var(--accent-soft); }
  .artifact-preview { margin-top: 8px; }
  .artifact-preview .ph { color: var(--ink-faint); font-size: 12px; }
  .group-tabs { display: flex; gap: 4px; margin-bottom: 10px; }
  .group-tabs .gtab {
    appearance: none; border: 1px solid var(--line); background: transparent; color: var(--ink-dim);
    border-radius: 999px; padding: 3px 11px; font-size: 11px; font-family: inherit; cursor: pointer;
    transition: all 0.25s var(--ease);
  }
  .group-tabs .gtab.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); font-weight: 600; }
  .group { margin-bottom: 10px; }
  .group-title {
    font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-faint);
    margin-bottom: 5px; padding-bottom: 3px; border-bottom: 1px dashed var(--line);
  }
  .group .artifact-item { margin-bottom: 5px; }

  /* 执行面板 */
  .exec { padding: 13px 16px 15px; }
  .exec-empty { color: var(--ink-faint); font-size: 12.5px; }
  .task-item { border: 1px solid var(--line); border-radius: var(--radius-md); padding: 10px 13px; margin-bottom: 8px; cursor: pointer; transition: border-color 0.25s var(--ease); }
  .task-item:hover { border-color: var(--accent); transform: translateY(-1px); box-shadow: 0 3px 10px rgba(38, 34, 28, 0.07); }
  .task-item:last-child { margin-bottom: 0; }
  .task-head { display: flex; align-items: center; gap: 10px; margin-bottom: 7px; }
  .task-id { font-size: 11px; color: var(--ink-faint); font-family: monospace; }
  .task-stage {
    font-size: 10px; letter-spacing: 0.06em; background: var(--surface-deep);
    border-radius: 5px; padding: 2px 8px; color: var(--ink-dim);
  }
  .task-status { margin-left: auto; font-size: 11px; font-weight: 600; }
  .task-status.run { color: var(--accent); }
  .task-status.done { color: var(--ok); }
  .task-status.err { color: var(--err); }
  .task-chev { font-size: 10px; color: var(--ink-faint); }
  .prog { height: 4px; border-radius: 2px; background: var(--surface-deep); overflow: hidden; margin-bottom: 7px; }
  .prog-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.5s var(--ease); }
  .task-log { font-size: 11.5px; color: var(--ink-dim); line-height: 1.5; }
  .task-paths { font-size: 11px; color: var(--ink-faint); margin-top: 5px; word-break: break-all; }

  /* 空态 */
  .empty-state { padding: 60px 20px; text-align: center; color: var(--ink-faint); }
  .empty-state .es-title {
    font-family: "Noto Serif SC", serif; font-size: 15px; color: var(--ink-dim); margin-bottom: 6px;
  }
  .empty-state .es-hint { font-size: 12.5px; }

  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; }
  }
</style>
<script src="./gsap.min.js"></script>
</head>
<body>
  <div class="topbar">
    <div class="brand">
      <span class="brand-name">视频工坊</span>
      <span class="brand-sub">OpenMontage Studio</span>
    </div>
    <div class="spacer"></div>
    ${pipelineNote ? `<span class="pipeline-badge">${esc(pipelineNote)}</span>` : ''}
    ${repoError ? `<span class="pipeline-badge err">管线读取失败</span>` : ''}
    <div class="project-picker" id="projectPicker">
      <button class="project-picker-btn" id="projectSelectBtn" aria-haspopup="true" aria-expanded="false">${selectedId ? esc(project.title) : '选择项目'}</button>
      <div class="project-pop" id="projectPop" role="menu"></div>
    </div>
    <button class="btn-plain" id="btnStations" title="检查或创建三个工位 Agent（编/导/制），缺失时自动创建插件私有 Agent">准备工位</button>
    <button class="btn-new" id="btnNewProject">新建项目</button>
  </div>

  <!-- 新建项目模态 -->
  <div class="modal-mask" id="modalMask">
    <div class="modal">
      <h3>新建视频项目</h3>
      <div class="sub">创建后自动初始化工序与资产目录</div>
      <div class="field">
        <label>标题 *</label>
        <input id="npTitle" type="text" placeholder="例如：三分钟解说 AI Agent">
      </div>
      <div class="field">
        <label>需求</label>
        <textarea id="npBrief" placeholder="一句话需求：给谁看、看完要做什么…"></textarea>
      </div>
      <div class="field">
        <label>管线</label>
        <select id="npPipeline">
          <option value="generic">generic · 通用（默认工序）</option>
        </select>
        <div class="sub" style="margin-top:5px;">选定管线后，其工序与验收标准将随项目初始化</div>
      </div>
      <div class="field">
        <label>工作台路径（可选）</label>
        <div style="display:flex;gap:8px;">
          <input id="npWorkDir" type="text" placeholder="选择或填写本地文件夹；留空使用插件数据目录" style="flex:1;">
          <button type="button" class="btn-plain" id="npPickDir">选择…</button>
        </div>
        <div class="sub" style="margin-top:5px;">绑定后，素材与产物都存放在这个文件夹，Hana 桌面端可直接预览</div>
      </div>
      <div class="modal-actions">
        <button class="btn-plain" id="npCancel">取消</button>
        <button class="btn-primary" id="npSubmit">创建项目</button>
      </div>
    </div>
  </div>

  <!-- 工件预览模态 -->
  <div class="modal-mask" id="previewMask">
    <div class="modal modal-wide">
      <div class="modal-head">
        <h3 id="previewTitle"></h3>
        <button class="btn-plain" id="previewClose">关闭</button>
      </div>
      <div class="modal-body" id="previewBody"></div>
    </div>
  </div>

  ${hasProject ? `
  <div class="filmstrip">${renderFilmStrip(stages, project.currentStageId)}</div>

  <div class="project-head">
    <span class="project-title">${esc(project.title)}</span>
    <span class="project-brief">${esc(project.brief || '')}</span>
    ${project.audience ? `<span class="project-audience">${esc(project.audience)}</span>` : ''}
    ${project.workDir ? `<span class="project-audience" title="工作台根目录">工作台 · ${esc(project.workDir)}</span>` : ''}
    ${project.workDir ? `<button class="btn-plain" id="btnChangeWorkdir" title="重新选择工作台文件夹">更换工作台</button>` : ''}
    ${project.needUserVerdict ? '<span class="verdict-tag">待你裁决 · 连续回退触发</span>' : ''}
    ${repoError ? `<span class="pipeline-badge err" style="font-size:11px;">${esc(repoError)}</span>` : ''}
    <button class="btn-plain" id="btnImport" title="导入本地文件到工作台，自动登记为工件">导入文件</button>
    <input type="file" id="importInput" multiple style="display:none;">
    <button class="btn-plain" id="btnImportDir" title="导入整个文件夹到工作台，按相对结构存放">导入文件夹</button>
    <input type="file" id="importDirInput" webkitdirectory style="display:none;">
  </div>

  <div class="main">
    <div class="card">
      <div class="card-head">
        <span class="card-title">工位</span>
        <div class="tabs" id="tabs"></div>
      </div>
      <div class="card-body">
        <div class="thread-meta" id="threadMeta"></div>
        <div class="thread" id="threadText"><span class="ph">载入中…</span></div>
        <div class="composer">
          <textarea id="msgInput" rows="1" placeholder="向该工位发消息…"></textarea>
          <button id="sendBtn">发送</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><span class="card-title">工件库</span><button class="btn-plain" id="btnDeliverAll" style="padding:3px 10px;font-size:11px;" title="把全部工件复制到桌面端工作台，Hana 可直接预览">投递全部</button></div>
      <div class="card-body">
        <div class="artifact-list" id="artifactList">
          <div class="artifact-empty">工序产出的工件将在这里归档<br>（T8 接入）</div>
        </div>
      </div>
    </div>
  </div>

  <div class="card exec">
    <div class="card-head" style="padding:0 0 8px;"><span class="card-title">执行面板</span></div>
    <div id="execList"><div class="exec-empty">载入中…</div></div>
  </div>

  <script>window.PROJECT_ID = ${jsSafe(project.id)};</script>
  <script>window.PROJECTS = ${jsSafe(projects.map((p) => ({ id: p.id, title: p.title, pipelineId: p.pipelineId, updatedAt: p.updatedAt })))};</script>
  <script>window.AGENTS = ${jsSafe(agents)};</script>
  <script>${loadAppJs()}</script>
  ` : `
  <div class="empty-state">
    <div class="es-title">还没有项目</div>
    <div class="es-hint">在对话中让助手调用 project_create 创建第一个视频项目。</div>
  </div>
  `}
</body>
</html>`;

    return new Response(html, {
      headers: secHeaders({ 'Content-Type': 'text/html; charset=utf-8' }),
    });
  });

  // 注册 API 路由（T5/T6/T8/T9 后端桥）
  registerApiRoutes(app, ctx);
}
