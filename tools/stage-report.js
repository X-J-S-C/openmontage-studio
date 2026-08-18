// OpenMontage Studio - 工具：工位申报待验 (T4)
import { loadProject, saveProject } from '../lib/store.js';
import { reportReady } from '../lib/flow.js';
import { assertStageGate } from '../lib/auth.js';

export const name = 'stage_report';
export const description =
  '工位申报：把某阶段状态置为"待验"，表示该工位（编/导/制）工作完成等待验收。参数：projectId、stageId。';

export const parameters = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: '项目 id' },
    stageId: { type: 'string', description: '阶段 id，如 script/storyboard/assets/edit/compose/review/deliver' },
  },
  required: ['projectId', 'stageId'],
  additionalProperties: false,
};

export const sessionPermission = {
  kind: 'plugin_output',
};

function reply(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

export async function execute(input, ctx) {
  if (!ctx.dataDir) {
    return reply({ ok: false, error: 'ctx.dataDir 不可用' });
  }
  const project = loadProject(ctx.dataDir, input.projectId);
  if (!project) {
    return reply({ ok: false, error: '项目不存在: ' + input.projectId });
  }
  const gate = await assertStageGate(ctx, project, input.stageId, "report");
  if (!gate.ok) return reply(gate);

  const result = reportReady(project, input.stageId);
  if (!result.ok) {
    return reply(result);
  }
  saveProject(ctx.dataDir, project);
  return reply({ ok: true, stageId: input.stageId, status: result.stage.status, project });
}
