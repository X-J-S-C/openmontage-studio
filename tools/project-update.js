// OpenMontage Studio - 工具：更新项目 (T3)
// 支持：更新标题/需求/观众/管线；按 stageId 更新阶段状态
// 注意：阶段推进/回退的合法性校验与版本管理在 T4 状态机中实现，本工具只做数据写入
import { loadProject, saveProject, loadIndex, saveIndex } from '../lib/store.js';

export const name = 'project_update';
export const description =
  '更新视频项目：可改 title/brief/audience/pipelineId；或用 stageId+status 更新某阶段状态（status 取值：待料/进行中/待验/已交付）。参数：projectId 必填，其余按需。';

export const parameters = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: '项目 id' },
    title: { type: 'string', description: '新标题，可选' },
    brief: { type: 'string', description: '新需求，可选' },
    audience: { type: 'string', description: '新目标观众，可选' },
    pipelineId: { type: 'string', description: '新管线标识，可选' },
    workDir: { type: 'string', description: '新工作台根目录（本地文件夹绝对路径），可选' },
    stageId: { type: 'string', description: '要更新状态的阶段 id，可选' },
    status: { type: 'string', description: '阶段新状态：待料/进行中/待验/已交付，可选' },
  },
  required: ['projectId'],
  additionalProperties: false,
};

export const sessionPermission = {
  kind: 'plugin_output',
};

function reply(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

export async function execute(input, ctx) {
  const dataDir = ctx.dataDir;
  if (!dataDir) {
    return reply({ ok: false, error: 'ctx.dataDir 不可用' });
  }

  const project = loadProject(dataDir, input.projectId);
  if (!project) {
    return reply({ ok: false, error: '项目不存在: ' + input.projectId });
  }

  if (input.title !== undefined) project.title = input.title;
  if (input.brief !== undefined) project.brief = input.brief;
  if (input.audience !== undefined) project.audience = input.audience;
  if (input.pipelineId !== undefined) project.pipelineId = input.pipelineId;
  if (input.workDir !== undefined) project.workDir = String(input.workDir).trim();

  if (input.stageId && input.status) {
    const stage = project.stages.find((s) => s.stageId === input.stageId);
    if (!stage) {
      return reply({ ok: false, error: '阶段不存在: ' + input.stageId, project });
    }
    const allowed = ['待料', '进行中', '待验', '已交付'];
    if (!allowed.includes(input.status)) {
      return reply({ ok: false, error: '非法状态: ' + input.status + '，可选：' + allowed.join('/'), project });
    }
    stage.status = input.status;
  }

  project.updatedAt = new Date().toISOString();
  saveProject(dataDir, project);

  const indexData = loadIndex(dataDir);
  const entry = (indexData.projects || []).find((p) => p.id === project.id);
  if (entry) {
    entry.title = project.title;
    entry.pipelineId = project.pipelineId;
    entry.updatedAt = project.updatedAt;
    saveIndex(dataDir, indexData);
  }

  return reply({ ok: true, project });
}
