// OpenMontage Studio - 工具：更新项目元数据（T3 / P2-1）
// 仅允许更新元数据：title/brief/audience/pipelineId/workDir。
// 阶段状态一律走状态机（stage_report/stage_approve/stage_reject），禁止在此直接写 status，
// 以免绕过推进/回退的合法性校验与版本管理。
import { loadProject, saveProject, loadIndex, saveIndex } from '../lib/store.js';
import { STATUS } from '../lib/flow.js';
import { isValidWorkDir } from '../lib/path.js';

export const name = 'project_update';
export const description =
  '更新视频项目元数据：可改 title/brief/audience/pipelineId/workDir。注意：阶段状态不在此工具修改，请用 stage_report（工位申报待验）/stage_approve（验收通过推进）/stage_reject（验收不过回退）。参数：projectId 必填，其余按需。';

export const parameters = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: '项目 id' },
    title: { type: 'string', description: '新标题，可选' },
    brief: { type: 'string', description: '新需求，可选' },
    audience: { type: 'string', description: '新目标观众，可选' },
    pipelineId: { type: 'string', description: '新管线标识，可选' },
    workDir: { type: 'string', description: '新工作台根目录（本地文件夹绝对路径），可选' },
  },
  required: ['projectId'],
  additionalProperties: false,
};

export const sessionPermission = { kind: 'plugin_output' };

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

  // P2-1：拒绝直接写阶段状态——状态流转必须走状态机工具
  if (input.stageId !== undefined || input.status !== undefined) {
    return reply({
      ok: false,
      error: '不允许在 project_update 中直接写阶段状态。状态流转请调用 stage_report / stage_approve / stage_reject（合法状态：' +
        Object.values(STATUS).join('/') + '）。',
      project,
    });
  }

  if (input.title !== undefined) project.title = input.title;
  if (input.brief !== undefined) project.brief = input.brief;
  if (input.audience !== undefined) project.audience = input.audience;
  if (input.pipelineId !== undefined) project.pipelineId = input.pipelineId;
  if (input.workDir !== undefined) {
    const chk = isValidWorkDir(input.workDir, dataDir);
    if (!chk.ok) return reply({ ok: false, error: "工作台路径非法: " + chk.reason });
    project.workDir = chk.value;
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
