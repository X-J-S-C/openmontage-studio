// OpenMontage Studio - 工具：验收不过（回退）(T4)
import { loadProject, saveProject } from '../lib/store.js';
import { reject } from '../lib/flow.js';

export const name = 'stage_reject';
export const description =
  '验收不过并回退：退回指定阶段（可跨级），目标阶段重新开工、工件 version+1；同一阶段连续回退 2 次触发待晟裁决标记。仅验收人（导或晟）调用。参数：projectId、stageId、targetStageId、mustFix（必修项，必填）、suggestions（可选）。';

export const parameters = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: '项目 id' },
    stageId: { type: 'string', description: '当前验收的阶段 id' },
    targetStageId: { type: 'string', description: '回退目标阶段 id（必须早于当前阶段）' },
    mustFix: {
      type: 'array',
      items: { type: 'string' },
      description: '必修项（不过即回退的硬性意见）',
    },
    suggestions: {
      type: 'array',
      items: { type: 'string' },
      description: '建议项，可选',
    },
  },
  required: ['projectId', 'stageId', 'targetStageId', 'mustFix'],
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
  const result = reject(project, input.stageId, input.targetStageId, {
    mustFix: input.mustFix || [],
    suggestions: input.suggestions || [],
  });
  if (!result.ok) {
    return reply(result);
  }
  saveProject(ctx.dataDir, project);
  return reply({ ok: true, ...result, project });
}
