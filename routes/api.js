// OpenMontage Studio - API 路由 (T5/T6/T8/T9 后端桥)
// 前端 app.js 调用的 5 个 API 端点，桥接后端 lib 模块与 session bus
// 端点设计：薄壳层，只做 HTTP↔业务 适配，不承载业务逻辑

import { loadProject, saveProject } from '../lib/store.js';
import { loadTasks } from '../lib/tasks.js';
import { buildProjectContext } from '../lib/context.js';
import { listPipelines } from '../lib/pipelines-list.js';
import { execute as createProjectExecute } from '../tools/project-create.js';
import { getConfig, agentIds, agentList } from '../lib/config.js';
import { setupStations } from '../lib/stations.js';
import { autoRegister } from '../lib/scan.js';
import { isValidWorkDir } from '../lib/path.js';
import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// ── helpers ──

function getCtx(c, fallbackCtx) {
  return c.get('pluginCtx') || fallbackCtx || {};
}

function json(c, obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: secHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
  });
}

const CONTENT_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac',
  '.pdf': 'application/pdf',
  '.json': 'application/json', '.js': 'text/javascript',
  '.md': 'text/markdown', '.txt': 'text/plain',
  '.html': 'text/html', '.css': 'text/css',
  '.yaml': 'text/yaml', '.yml': 'text/yaml',
};

function contentTypeFor(filePath) {
  const ext = extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

// 最小安全响应头：统一加在 json() 与页面/文件响应上
function secHeaders(extra) {
  return Object.assign({}, extra || {}, {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
}

// 导入扩展名白名单。拒绝策略：未见于 SAVE_TYPES 的类型一律 400；
// svg/html/xml/js/css/exe 等预览炸弹或代码刻意不入表（拒绝）。
const SAVE_TYPES = {
  'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp',
  'mp4': 'video/mp4', 'webm': 'video/webm', 'mov': 'video/quicktime', 'm4v': 'video/x-m4v',
  'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'aac': 'audio/aac', 'm4a': 'audio/mp4',
  'pdf': 'application/pdf',
  'txt': 'text/plain', 'md': 'text/markdown', 'csv': 'text/csv', 'json': 'application/json',
  'zip': 'application/zip',
};
const MAX_IMPORT_BYTES = 200 * 1024 * 1024;                 // 200MB 二进制上限
const MAX_IMPORT_BASE64 = Math.ceil(MAX_IMPORT_BYTES / 3) * 4 + 4; // base64 文本长度上限



// 工位 agent 白名单来自用户配置（manifest configuration），不硬编码
async function validAgentIds(pluginCtx) {
  try {
    const cfg = await getConfig(pluginCtx);
    return agentIds(cfg.agents);
  } catch {
    return [];
  }
}

// 工位 agent 未就绪时的引导文案：列出当前配置，把用户直接送到解决方案前
async function agentSetupHint(pluginCtx) {
  try {
    const cfg = await getConfig(pluginCtx);
    const list = agentList(cfg.agents);
    return '工位 Agent 可能未就绪。当前配置：' + list.map((a) => a.name + '=' + a.id).join('、') + '。请确认这些 Agent 已在 Hana 中创建并启用，或到插件设置里改成本机真实存在的 Agent id。';
  } catch {
    return '请检查插件设置里的工位 Agent 配置。';
  }
}

// 工作台自动登记节流（前端 5s 轮询，只允许每 8s 扫一次盘）
let artifactScanTs = 0;

// 找到或创建 agent 会话，返回 sessionId（复用会话创建模式）
async function ensureSession(pluginCtx, project, agentId) {
  const bus = pluginCtx.bus;
  if (!bus || typeof bus.request !== 'function') return null;

  let sessionId = project.threads && project.threads[agentId];
  if (sessionId) return sessionId;

  // cwd 统一用 dataDir（设计稿中制指向工作区的需求待 project.workDir 字段就绪后接通）
  const cwd = pluginCtx.dataDir;

  const created = await bus.request('session:create', {
    agentId,
    kind: 'tavern',
    visibility: 'plugin_private',
    memoryEnabled: true,
    ownerPluginId: pluginCtx.pluginId,
    cwd,
  });
  sessionId = created && (created.sessionId || (created.sessionRef && created.sessionRef.sessionId));
  if (!sessionId) return null;

  if (!project.threads) project.threads = {};
  project.threads[agentId] = sessionId;
  saveProject(pluginCtx.dataDir, project);
  return sessionId;
}

// 解析工件路径：只允许项目 workDir / dataDir 内的相对路径
// 发布版加固：拒绝目录穿越（..）与任意绝对路径，防越权读取项目外文件
function resolveArtifactPath(pluginCtx, project, artifactPath) {
  if (!artifactPath) return null;
  const norm = String(artifactPath).split(/[\\/]+/);
  if (norm.some((seg) => seg === '..')) return null;
  const bases = [
    project.workDir,
    join(pluginCtx.dataDir, 'projects', project.id),
  ].filter(Boolean);
  for (const base of bases) {
    const full = join(base, ...norm);
    if (existsSync(full)) return full;
  }
  return null;
}

// 格式化 session 消息为纯文本（兼容多种可能的 session:get 返回形状）
function formatMessages(got) {
  if (!got) return { messageCount: 0, text: '' };
  const messages = got.messages || (got.session && got.session.messages) || got.history || [];
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messageCount: 0, text: '' };
  }
  const lines = messages.map((m) => {
    const role = m.role || m.author || m.sender || '';
    const content = m.content || m.text || m.body || (typeof m === 'string' ? m : '');
    if (role) {
      const label = role === 'user' || role === 'human' ? '我' :
                    role === 'assistant' || role === 'ai' || role === 'model' ? '工位' : role;
      return `[${label}] ${content}`;
    }
    return content;
  });
  return { messageCount: messages.length, text: lines.join('\n\n') };
}

// ── 路由注册 ──

export function registerApiRoutes(app, ctx) {
  // GET /api/thread — 加载工位会话消息
  app.get('/api/thread', async (c) => {
    const pluginCtx = getCtx(c, ctx);
    const url = new URL(c.req.url);
    const projectId = url.searchParams.get('projectId');
    const agentId = url.searchParams.get('agentId');

    if (!projectId) return json(c, { ok: false, error: '缺少 projectId' });
    const valid = await validAgentIds(pluginCtx);
    if (!agentId || !valid.includes(agentId)) return json(c, { ok: false, error: '缺少或无效 agentId' });

    const dataDir = pluginCtx.dataDir;
    if (!dataDir) return json(c, { ok: false, error: 'dataDir 不可用' });

    const project = loadProject(dataDir, projectId);
    if (!project) return json(c, { ok: false, error: '项目不存在' });

    const sessionId = project.threads && project.threads[agentId];
    if (!sessionId) {
      return json(c, { ok: true, sessionId: null, messageCount: 0, text: '', agentId });
    }

    const bus = pluginCtx.bus;
    if (!bus || typeof bus.request !== 'function') {
      return json(c, { ok: false, error: 'bus 不可用' });
    }

    try {
      const got = await bus.request('session:get', { sessionId });
      const { messageCount, text } = formatMessages(got);
      return json(c, { ok: true, sessionId, messageCount, text, agentId });
    } catch (e) {
      // 读取失败不删线程、不自愈：轮询场景下宿主偶发失败（如 session-meta 过大）
      // 误删会把还活着的会话清掉，造成“消息显示一下又消失”。
      // 真正失效的线程由发送路径（POST /api/thread/message）自愈重建。
      const msg = e && e.message ? String(e.message) : String(e);
      return json(c, { ok: false, error: '会话读取失败: ' + msg, keepSession: true });
    }
  });

  // 管线列表（新建项目表单下拉）
  app.get('/api/pipelines', async (c) => {
    try {
      const pctx = getCtx(c, ctx);
      let pipelines = [];
      let error = '';
      const cfg = await getConfig(pctx);
      const repoPath = cfg.repoPath;
      if (repoPath && pctx.resources && typeof pctx.resources.list === 'function') {
        try {
          pipelines = await listPipelines(pctx.resources, repoPath);
        } catch (e) {
          error = e && e.message ? e.message : String(e);
        }
      } else {
        error = '仓库路径未配置或资源通道不可用';
      }
      return json(c, { ok: true, pipelines, error });
    } catch (e) {
      return json(c, { ok: false, error: '内部错误: ' + (e && e.message ? e.message : String(e)) }, 500);
    }
  });

  // 项目完整数据（含各阶段验收记录，供阶段详情/验收面板）
  app.get('/api/project', async (c) => {
    try {
      const pctx = getCtx(c, ctx);
      const url = new URL(c.req.url);
      const projectId = url.searchParams.get('projectId') || '';
      if (!projectId) return json(c, { ok: false, error: 'projectId 必填' }, 400);
      const project = loadProject(pctx.dataDir, projectId);
      if (!project) return json(c, { ok: false, error: '项目不存在' }, 404);
      return json(c, { ok: true, project });
    } catch (e) {
      return json(c, { ok: false, error: '内部错误: ' + (e && e.message ? e.message : String(e)) }, 500);
    }
  });

  // 新建项目（复用 project_create 工具逻辑，供前端表单调用）
  app.post('/api/project', async (c) => {
    const pctx = getCtx(c, ctx);
    let body = {};
    try {
      body = await c.req.json();
    } catch {
      return json(c, { ok: false, error: '请求体不是合法 JSON' }, 400);
    }
    const toolCtx = { ...pctx, pluginId: pctx.pluginId || 'openmontage-studio' };
    const result = await createProjectExecute(body, toolCtx);
    const text = result && result.content && result.content[0] && result.content[0].text;
    let parsed = { ok: false, error: '创建失败' };
    if (text) {
      try { parsed = JSON.parse(text); } catch { /* 保持默认 */ }
    }
    return json(c, parsed, parsed.ok ? 200 : 400);
  });

  // POST /api/project/workdir — 更换项目工作台（页面按钮用，同步 project_update 工具能力）
  app.post('/api/project/workdir', async (c) => {
    const pctx = getCtx(c, ctx);
    const dataDir = pctx.dataDir;
    if (!dataDir) return json(c, { ok: false, error: 'dataDir 不可用' });

    let body;
    try {
      body = await c.req.json();
    } catch {
      return json(c, { ok: false, error: '请求体解析失败' }, 400);
    }
    const { projectId, workDir } = body || {};
    if (!projectId) return json(c, { ok: false, error: '缺少 projectId' }, 400);
    if (!workDir || !String(workDir).trim()) return json(c, { ok: false, error: '缺少 workDir' }, 400);

    const project = loadProject(dataDir, projectId);
    if (!project) return json(c, { ok: false, error: '项目不存在' }, 404);

    const chk = isValidWorkDir(String(workDir).trim(), dataDir);
    if (!chk.ok) return json(c, { ok: false, error: '工作台路径非法: ' + chk.reason }, 400);

    project.workDir = chk.value;
    project.updatedAt = new Date().toISOString();
    saveProject(dataDir, project);
    return json(c, { ok: true, workDir: project.workDir });
  });

  // POST /api/import — 上传文件到项目工作台（页面「导入文件」按钮用，base64 JSON）
  app.post('/api/import', async (c) => {
    const pctx = getCtx(c, ctx);
    const dataDir = pctx.dataDir;
    if (!dataDir) return json(c, { ok: false, error: 'dataDir 不可用' });

    let body;
    try {
      body = await c.req.json();
    } catch {
      return json(c, { ok: false, error: '请求体解析失败' }, 400);
    }

    const { projectId, name, dataBase64, type, title } = body || {};
    if (!projectId || !name || !dataBase64) {
      return json(c, { ok: false, error: '缺少 projectId/name/dataBase64' }, 400);
    }
    if (String(name).includes('..')) {
      return json(c, { ok: false, error: '文件名非法' }, 400);
    }
    // base64 合法性：字符串、长度 4 的倍数、仅含合法 base64 字符、大小不超上限
    if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
      return json(c, { ok: false, error: 'dataBase64 非法' }, 400);
    }
    if (dataBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64)) {
      return json(c, { ok: false, error: 'dataBase64 格式非法' }, 400);
    }
    if (dataBase64.length > MAX_IMPORT_BASE64) {
      return json(c, { ok: false, error: '文件过大（上限 200MB）' }, 400);
    }

    const project = loadProject(dataDir, projectId);
    if (!project) return json(c, { ok: false, error: '项目不存在' }, 404);

    const root = project.workDir ? project.workDir : join(dataDir, 'projects', project.id);
    // 相对子路径（如 assets/img/01.png），逐段校验拒绝穿越与绝对路径
    const relSegs = String(name).split(/[\\/]+/).filter(Boolean);
    if (relSegs.length === 0 || relSegs.some((s) => s === '..')) {
      return json(c, { ok: false, error: '文件名非法' }, 400);
    }
    const safeRel = relSegs.join('/');
    // 扩展名白名单：未知/预览炸弹（html/svg/xml/js/css 等）一律 400
    const ext = extname(safeRel).toLowerCase().replace(/^\./, '');
    if (!SAVE_TYPES[ext]) {
      return json(c, { ok: false, error: '文件类型不允许导入: .' + ext + '（仅支持图片/视频/音频/PDF/文本/JSON/ZIP）' }, 400);
    }
    const target = join(root, ...relSegs);
    // 写盘前断言：resolve 后仍位于项目根（workDir 或 dataDir/projects/{id}）之内
    if (!resolve(target).startsWith(resolve(root))) {
      return json(c, { ok: false, error: '目标路径越界' }, 400);
    }

    try {
      mkdirSync(resolve(target, '..'), { recursive: true });
      writeFileSync(target, Buffer.from(String(dataBase64), 'base64'));
    } catch (e) {
      return json(c, { ok: false, error: '写入失败: ' + (e && e.message ? e.message : String(e)) }, 500);
    }

    // 登记工件到当前阶段
    const stage = project.stages.find((s) => s.stageId === project.currentStageId) || project.stages[0];
    if (!Array.isArray(stage.artifacts)) stage.artifacts = [];
    const same = stage.artifacts.filter((a) => a.path === safeRel);
    const version = same.length > 0 ? Math.max(...same.map((a) => a.version || 1)) + 1 : 1;
    const artifact = {
      id: 'a_' + randomUUID().slice(0, 8),
      type: type || 'asset',
      path: safeRel,
      version,
      stageId: stage.stageId,
      title: title || basename(safeRel),
      createdAt: new Date().toISOString(),
    };
    stage.artifacts.push(artifact);
    project.updatedAt = new Date().toISOString();
    saveProject(dataDir, project);

    return json(c, { ok: true, artifact });
  });

  // POST /api/desk-deliver — 投递工件到 Hana 桌面端工作台（探测默认 desk 目录后复制）
  app.post('/api/desk-deliver', async (c) => {
    const pctx = getCtx(c, ctx);
    const dataDir = pctx.dataDir;
    if (!dataDir) return json(c, { ok: false, error: 'dataDir 不可用' });

    let body;
    try {
      body = await c.req.json();
    } catch {
      return json(c, { ok: false, error: '请求体解析失败' }, 400);
    }
    const { projectId, path } = body || {};
    if (!projectId || !path) return json(c, { ok: false, error: '缺少 projectId/path' }, 400);

    const project = loadProject(dataDir, projectId);
    if (!project) return json(c, { ok: false, error: '项目不存在' }, 404);

    const src = resolveArtifactPath(pctx, project, path);
    if (!src) return json(c, { ok: false, error: '工件文件不存在: ' + path }, 404);

    // 探测默认工作台目录（公开读路由，同源调用；无凭证时可能 403）
    let deskDir = '';
    let probeStatus = '';
    try {
      const origin = new URL(c.req.url).origin;
      const r = await fetch(origin + '/api/desk/path', { headers: { Accept: 'application/json' } });
      probeStatus = 'http_' + r.status;
      const d = await r.json().catch(() => ({}));
      deskDir = (d && (d.dir || d.basePath || d.path)) || '';
    } catch (e) {
      probeStatus = 'fetch_err: ' + (e && e.message ? String(e.message).slice(0, 80) : String(e));
    }

    const cfg = await getConfig(pctx);
    const base = (cfg.deskDeliverDir || deskDir || '').trim();
    pctx.log?.info?.('desk-deliver probe', { projectId, probeStatus, deskDir, base, src });
    if (!base) {
      return json(c, {
        ok: false,
        error: '未找到工作台目录（自动探测返回 ' + (probeStatus || '空') + '）。请到插件设置里配置「工作台投递目录」（如 C:\\Users\\你的用户名\\Desktop\\工作台目录），或把项目工作台绑定到 Hana 可见的文件夹。',
      });
    }

    // 投递目录：{desk}/openmontage/{projectId}/，文件名保持工件名
    const fileName = basename(src);
    const targetDir = join(base, 'openmontage', project.id);
    const target = join(targetDir, fileName);
    try {
      mkdirSync(targetDir, { recursive: true });
      copyFileSync(src, target);
    } catch (e) {
      return json(c, { ok: false, error: '复制失败: ' + (e && e.message ? e.message : String(e)) }, 500);
    }
    return json(c, { ok: true, source: src, targetDir, copiedTo: target });
  });

  // POST /api/stations/setup — 一键准备工位 Agent（页面按钮调用，复用工具逻辑）
  app.post('/api/stations/setup', async (c) => {
    const pctx = getCtx(c, ctx);
    const result = await setupStations(pctx);
    return json(c, result, result.ok ? 200 : 500);
  });

  // POST /api/thread/message — 向工位发送消息
  app.post('/api/thread/message', async (c) => {
    const pluginCtx = getCtx(c, ctx);
    const dataDir = pluginCtx.dataDir;
    if (!dataDir) return json(c, { ok: false, error: 'dataDir 不可用' });

    let body;
    try {
      body = await c.req.json();
    } catch {
      return json(c, { ok: false, error: '请求体解析失败' }, 400);
    }

    const { projectId, agentId, text } = body || {};
    if (!projectId) return json(c, { ok: false, error: '缺少 projectId' });
    const valid = await validAgentIds(pluginCtx);
    if (!agentId || !valid.includes(agentId)) return json(c, { ok: false, error: '缺少或无效 agentId' });
    if (!text || !text.trim()) return json(c, { ok: false, error: '消息内容为空' });

    const project = loadProject(dataDir, projectId);
    if (!project) return json(c, { ok: false, error: '项目不存在' });

    const bus = pluginCtx.bus;
    if (!bus || typeof bus.request !== 'function') {
      return json(c, { ok: false, error: 'bus 不可用' });
    }

    try {
      const sessionId = await ensureSession(pluginCtx, project, agentId);
      if (!sessionId) return json(c, { ok: false, error: '工位会话创建失败（Agent: ' + agentId + '）', hint: await agentSetupHint(pluginCtx) });

      const contextText = buildProjectContext(project);
      const sent = await bus.request('session:send', {
        sessionId,
        text,
        context: {
          afterUser: [{ label: 'project-context', text: contextText }],
        },
      });
      return json(c, { ok: true, sessionId, sent });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : String(e);
      if (/not\s*found/i.test(msg)) {
        // 自愈：清失效线程 → 重建会话 → 重试一次（宿主 agent 懒加载/缓存失效场景）
        try {
          if (project.threads) delete project.threads[agentId];
          saveProject(dataDir, project);
          const sessionId2 = await ensureSession(pluginCtx, project, agentId);
          if (!sessionId2) {
            return json(c, { ok: false, error: '工位会话重建失败（Agent: ' + agentId + '）', hint: await agentSetupHint(pluginCtx) });
          }
          const contextText = buildProjectContext(project);
          const sent2 = await bus.request('session:send', {
            sessionId: sessionId2,
            text,
            context: {
              afterUser: [{ label: 'project-context', text: contextText }],
            },
          });
          return json(c, { ok: true, sessionId: sessionId2, sent: sent2, rebuilt: true });
        } catch (e2) {
          const msg2 = e2 && e2.message ? String(e2.message) : String(e2);
          return json(c, {
            ok: false,
            error: '发送失败（已尝试重建会话）: ' + msg2,
            hint: await agentSetupHint(pluginCtx),
          });
        }
      }
      // 非 agent 类失败（宿主繁忙/超时/session-meta 过大等偶发问题）：自动重试一次，
      // 不扣“Agent 未就绪”的帽子，如实告知真实错误
      try {
        const retrySent = await bus.request('session:send', {
          sessionId,
          text,
          context: {
            afterUser: [{ label: 'project-context', text: buildProjectContext(project) }],
          },
        });
        return json(c, { ok: true, sessionId, sent: retrySent, retried: true });
      } catch (e3) {
        const msg3 = e3 && e3.message ? String(e3.message) : String(e3);
        return json(c, { ok: false, error: '发送失败（已自动重试一次）: ' + msg3 });
      }
    }
  });

  // GET /api/artifacts — 工件列表（聚合所有阶段）；顺带把工作台新文件自动登记
  app.get('/api/artifacts', async (c) => {
    const pluginCtx = getCtx(c, ctx);
    const dataDir = pluginCtx.dataDir;
    if (!dataDir) return json(c, { ok: false, error: 'dataDir 不可用' });

    const url = new URL(c.req.url);
    const projectId = url.searchParams.get('projectId');
    if (!projectId) return json(c, { ok: false, error: '缺少 projectId' });

    const project = loadProject(dataDir, projectId);
    if (!project) return json(c, { ok: false, error: '项目不存在' });

    // 工作台自动登记：文件落盘即入工件库（节流防频繁全扫）
    try {
      const now = Date.now();
      if (now - artifactScanTs > 8000) {
        artifactScanTs = now;
        autoRegister(project, dataDir);
      }
    } catch { /* 扫描失败不阻断列表 */ }

    const artifacts = [];
    for (const stage of (project.stages || [])) {
      for (const a of (stage.artifacts || [])) {
        artifacts.push({ ...a, stageName: stage.name, stageStatus: stage.status });
      }
    }
    return json(c, { ok: true, artifacts });
  });

  // GET /api/artifact/read — 读取工件文件内容（图片/视频/文本）
  app.get('/api/artifact/read', async (c) => {
    const pluginCtx = getCtx(c, ctx);
    const dataDir = pluginCtx.dataDir;
    if (!dataDir) return json(c, { ok: false, error: 'dataDir 不可用' });

    const url = new URL(c.req.url);
    const projectId = url.searchParams.get('projectId');
    const artifactPath = url.searchParams.get('path');
    if (!projectId) return json(c, { ok: false, error: '缺少 projectId' });
    if (!artifactPath) return json(c, { ok: false, error: '缺少 path' });

    const project = loadProject(dataDir, projectId);
    if (!project) return json(c, { ok: false, error: '项目不存在' });

    const fullPath = resolveArtifactPath(pluginCtx, project, artifactPath);
    if (!fullPath) return json(c, { ok: false, error: '文件不存在: ' + artifactPath }, 404);

    try {
      const ext = extname(fullPath).toLowerCase();
      // 仅安全类型内联回吐；svg/html/xml/js/css 等一律改为附件下载（防预览炸弹/脚本执行）
      const INLINE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
        '.mp4', '.webm', '.mov', '.m4v', '.mp3', '.wav', '.aac', '.m4a',
        '.pdf', '.txt', '.md', '.csv', '.json'];
      const ct = contentTypeFor(fullPath);
      const isText = ct.startsWith('text/') || ct === 'application/json';
      const headers = secHeaders({ 'Content-Type': ct + (isText ? '; charset=utf-8' : '') });
      if (INLINE_EXT.indexOf(ext) < 0) {
        headers['Content-Disposition'] = 'attachment; filename="' + String(basename(fullPath)).replace(/"/g, '') + '"';
      }
      if (isText) {
        const text = readFileSync(fullPath, 'utf-8');
        return new Response(text, { headers });
      }
      // 二进制文件：整文件读取（Hono 路由不支持 stream 直传，用 buffer 代替）
      const buffer = readFileSync(fullPath);
      return new Response(buffer, { headers });
    } catch (e) {
      return json(c, { ok: false, error: '读取失败: ' + (e && e.message ? e.message : String(e)) }, 500);
    }
  });

  // GET /api/tasks — 任务列表（按项目过滤）
  app.get('/api/tasks', async (c) => {
    const pluginCtx = getCtx(c, ctx);
    const dataDir = pluginCtx.dataDir;
    if (!dataDir) return json(c, { ok: false, error: 'dataDir 不可用' });

    const url = new URL(c.req.url);
    const projectId = url.searchParams.get('projectId');
    if (!projectId) return json(c, { ok: false, error: '缺少 projectId' });

    const store = loadTasks(dataDir);
    const tasks = (store.tasks || []).filter((t) => t.projectId === projectId);
    return json(c, { ok: true, tasks });
  });
}