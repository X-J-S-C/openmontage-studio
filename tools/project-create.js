// OpenMontage Studio - 工具：创建项目 (T3 + V1/V3 增强)
// V3：管线阶段动态读取（pipelineId 对应管线 YAML）+ 8 类资产目录骨架初始化
// 发布版：阶段 owner 统一由 角色（director/script/maker）→ 用户配置的 agent id 映射
import { loadIndex, saveIndex, saveProject, DEFAULT_STAGES } from '../lib/store.js';
import { loadPipelineStages } from '../lib/pipelines.js';
import { getConfig, roleToAgent } from '../lib/config.js';
import { isValidWorkDir } from '../lib/path.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const name = 'project_create';
export const description =
  '创建一个视频项目（Project）。参数：title 标题、brief 需求、pipelineId 管线标识（默认 generic）、audience 目标观众（可选）。创建时按管线初始化阶段列表，并生成 8 类资产目录骨架。';

export const parameters = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '项目标题' },
    brief: { type: 'string', description: '一句话需求' },
    pipelineId: { type: 'string', description: '管线标识，默认 generic', default: 'generic' },
    audience: { type: 'string', description: '目标观众与观看场景，可选' },
    workDir: { type: 'string', description: '工作台根目录（本地文件夹绝对路径，可选）；留空时使用插件数据目录' },
  },
  required: ['title', 'brief'],
  additionalProperties: false,
};

export const sessionPermission = {
  kind: 'plugin_output',
};

// 资产目录骨架（制 V2 方案：按"谁消费它"分类，中间产物隔离）
const ASSET_DIRS = [
  'scripts', 'scene_plans',
  'assets/svg_components', 'assets/voice_cards', 'assets/music_specs',
  'assets/tts_audio', 'assets/frames', 'assets/reference',
  'assets/intermediate', 'assets/final_clips',
  'edit', 'compose', 'publish',
];

function reply(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

// 初始化项目目录骨架（workDir 为用户指定的本地工作台，否则落在插件数据目录）
function initSkeleton(dataDir, projectId, workDir) {
  const root = workDir ? workDir : join(dataDir, 'projects', projectId);
  mkdirSync(root, { recursive: true });
  for (const d of ASSET_DIRS) {
    mkdirSync(join(root, d), { recursive: true });
  }
  return root;
}

export async function execute(input, ctx) {
  const dataDir = ctx.dataDir;
  if (!dataDir) {
    return reply({ ok: false, error: 'ctx.dataDir 不可用' });
  }

  const now = new Date().toISOString();
  const projectId = 'p_' + randomUUID().slice(0, 8);

  // 安全线：工作台路径校验（拒绝相对/系统目录/dataDir 本体及其上级/8.3 短名）
  let workDir = (input.workDir || '').trim();
  if (workDir) {
    const chk = isValidWorkDir(workDir, dataDir);
    if (!chk.ok) return reply({ ok: false, error: "工作台路径非法: " + chk.reason });
    workDir = chk.value;
  }

  // 用户配置：仓库路径 + 三个工位 agent id
  const cfg = await getConfig(ctx);

  // 管线阶段：pipelineId 非 generic 时动态读取，失败回退默认
  // stages 内 owner 最终全部为 agent id；DEFAULT_STAGES 的角色在此映射
  let stages = DEFAULT_STAGES.map((s) => ({ ...s, owner: roleToAgent(cfg.agents, s.owner) }));
  const pipelineId = input.pipelineId || 'generic';
  if (pipelineId !== 'generic') {
    try {
      if (cfg.repoPath && ctx.resources && typeof ctx.resources.read === 'function') {
        const pipelineStages = await loadPipelineStages(ctx.resources, cfg.repoPath, pipelineId, cfg.agents);
        if (pipelineStages.length > 0) {
          stages = pipelineStages;
        }
      }
    } catch { /* 读取失败回退默认 */ }
  }

  const project = {
    id: projectId,
    title: input.title,
    brief: input.brief,
    pipelineId,
    audience: input.audience || '',
    workDir: workDir,
    currentStageId: stages[0].stageId,
    stages: stages.map((s, i) => ({
      stageId: s.stageId,
      name: s.name,
      owner: s.owner,
      status: i === 0 ? '进行中' : '待料',
      artifacts: [],
      review: null,
      rejectStreak: 0,
    })),
    createdAt: now,
    updatedAt: now,
  };

  // 目录骨架（workDir 用户指定时建在用户文件夹；否则插件 dataDir）
  let root = '';
  try {
    root = initSkeleton(dataDir, projectId, project.workDir);
  } catch (e) {
    return reply({ ok: false, error: '目录骨架创建失败: ' + e.message });
  }

  const indexData = loadIndex(dataDir);
  indexData.projects.push({ id: project.id, title: project.title, pipelineId: project.pipelineId, updatedAt: now });
  saveIndex(dataDir, indexData);
  saveProject(dataDir, project);

  return reply({ ok: true, project, projectRoot: root });
}
