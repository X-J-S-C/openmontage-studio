// OpenMontage Studio - 工具：汇报任务状态 (T9)
// 制（或任意工位 agent）在工序执行节点主动调用，写入执行面板
// 参数：taskId 为空则新建任务，非空则更新

import { upsertTask } from '../lib/tasks.js';

export const name = 'task_report';
export const description =
  '汇报任务状态：工位在工序节点调用，任务状态会实时出现在插件的执行面板。参数：projectId 必填；taskId 已有则更新、缺省则新建；stageId、status（进行中/完成/失败）、progress（0-100）、logSummary、artifactPaths。';

export const parameters = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: '项目 id' },
    taskId: { type: 'string', description: '任务 id（更新时传）' },
    stageId: { type: 'string', description: '阶段 id' },
    status: { type: 'string', enum: ['进行中', '完成', '失败'], description: '任务状态' },
    progress: { type: 'integer', minimum: 0, maximum: 100, description: '进度 0-100' },
    logSummary: { type: 'string', description: '日志摘要' },
    artifactPaths: {
      type: 'array', items: { type: 'string' },
      description: '产出的工件路径列表（相对项目目录）',
    },
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
  const task = upsertTask(dataDir, {
    projectId: input.projectId,
    taskId: input.taskId,
    stageId: input.stageId,
    status: input.status,
    progress: input.progress,
    logSummary: input.logSummary,
    artifactPaths: input.artifactPaths,
  });
  return reply({ ok: true, task });
}
