// OpenMontage Studio - 工具：验收通过（推进）(T4)
import { loadProject, saveProject } from '../lib/store.js';
import { approve } from '../lib/flow.js';
import { assertStageGate } from '../lib/auth.js';

export const name = 'stage_approve';
export const description =
  '验收通过并推进：当前阶段置为"已交付"，下一阶段置为"进行中"。仅验收人（导或晟）调用。参数：projectId、stageId、suggestions（可选，被延后的建议项）。';

export const parameters = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: '项目 id' },
    stageId: { type: 'string', description: '要验收的阶段 id' },
    suggestions: {
      type: 'array',
      items: { type: 'string' },
      description: '建议项（不阻断推进，入库留档），可选',
    },
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
  const gate = await assertStageGate(ctx, project, input.stageId, "approve");
  if (!gate.ok) return reply(gate);

  const result = approve(project, input.stageId, {
    suggestions: input.suggestions || [],
  });
  if (!result.ok) {
    return reply(result);
  }
  saveProject(ctx.dataDir, project);
  return reply({ ok: true, ...result, project });
}
