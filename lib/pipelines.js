// OpenMontage Studio - 管线解析 (T5)
// 职责：从 OpenMontage-repo 的 pipeline_defs/*.yaml 读取管线清单与阶段列表
// 零依赖 YAML 解析（只解析 stages 列表，够用即止）
// 文件读取走 ctx.resources（用户工作区文件），不裸 fs

import { roleToAgent } from './config.js';

// stage name → 工位角色映射（OpenMontage 阶段无 agent 概念，由插件映射）
// 角色是固定的三种：director（导）/ script（编）/ maker（制）
// 角色 → 具体 agent id 的映射由用户配置（lib/config.js），不在此处硬编码
// 兜底规则：未匹配的阶段默认归 director（与 v0.1 行为一致）
export function stageRole(stageId) {
  const id = String(stageId || '').toLowerCase();
  if (['brief', 'idea', 'research', 'proposal', 'review', 'final_review'].includes(id)) {
    return 'director';
  }
  if (['script', 'scene_plan', 'storyboard'].includes(id)) {
    return 'script';
  }
  if (['assets', 'edit', 'compose', 'publish', 'deliver'].includes(id)) {
    return 'maker';
  }
  return 'director';
}

// 解析 YAML 文本中的 stages 列表（name 字段）
export function parseStages(yamlText) {
  const lines = String(yamlText || '').split(/\r?\n/);
  const stages = [];
  let inStages = false;
  let current = null;

  for (const line of lines) {
    if (!inStages) {
      if (line.trim() === 'stages:') {
        inStages = true;
      }
      continue;
    }
    // stages 块内：缩进回退到顶层（非空行且不以空格/制表符开头）说明块结束
    if (line.trim() === '') continue;
    if (!/^[\s\t]/.test(line) && !line.trim().startsWith('-')) {
      break;
    }
    const m = line.trim().match(/^-\s*name:\s*(.+)$/);
    if (m) {
      if (current) stages.push(current);
      current = { stageId: m[1].trim(), name: m[1].trim() };
    }
  }
  if (current) stages.push(current);
  return stages;
}

// 列出 pipeline_defs 目录下的全部管线（yaml 文件名去扩展名）
export async function listPipelines(resources, repoPath) {
  if (!repoPath) {
    throw new Error('repoPath 缺失');
  }
  const dirPath = repoPath.replace(/[\\/]+$/, '') + '/pipeline_defs';
  let entries = [];
  try {
    // 优先 list；部分实现返回目录条目
    const result = await resources.list({ kind: 'local-file', path: dirPath });
    entries = (result && (result.entries || result.items || result.files)) || [];
  } catch (e) {
    // list 失败退回 read 目录
    try {
      const result = await resources.read({ kind: 'local-file', path: dirPath });
      const raw = result && (result.content || result.text);
      const str = typeof raw === 'string' ? raw : JSON.stringify(raw || '');
      entries = [];
      const m = str.match(/[A-Za-z0-9_-]+\.yaml/g);
      if (m) entries = m.map((f) => ({ name: f }));
    } catch (e2) {
      throw new Error('读取管线目录失败: ' + (e2 && e2.message ? e2.message : String(e2)));
    }
  }
  return entries
    .filter((en) => en && typeof en.name === 'string' && en.name.endsWith('.yaml'))
    .map((en) => ({ id: en.name.replace(/\.yaml$/, ''), name: en.name.replace(/\.yaml$/, '') }));
}

// 读取某个管线的阶段列表；repoPath 来自配置，读取走 ctx.resources
// agents：角色 → agent id 映射（来自用户配置），owner 字段输出具体的 agent id
export async function loadPipelineStages(resources, repoPath, pipelineId, agents) {
  if (!repoPath || !pipelineId) {
    throw new Error('repoPath 或 pipelineId 缺失');
  }
  const filePath = repoPath.replace(/[\\/]+$/, '') + '/pipeline_defs/' + pipelineId + '.yaml';
  let text = '';
  try {
    const result = await resources.read({ kind: 'local-file', path: filePath });
    text = result && (result.content || result.text || '');
    if (typeof text !== 'string') {
      text = Buffer.isBuffer(text) ? text.toString('utf-8') : JSON.stringify(text);
    }
  } catch (e) {
    throw new Error('读取管线失败 ' + filePath + ': ' + (e && e.message ? e.message : String(e)));
  }
  return parseStages(text).map((s) => ({
    stageId: s.stageId,
    name: s.name,
    owner: roleToAgent(agents, stageRole(s.stageId)),
  }));
}
