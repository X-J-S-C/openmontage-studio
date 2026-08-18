// OpenMontage Studio - 项目上下文构建 (T7)
// 职责：为工位 agent 构建注入的 project context（设计稿 v0.3 / 导 M4）
// 注入原则：只放路径级摘要与决策信息，不放工件全文（制 5）

export function buildProjectContext(project) {
  const lines = [];
  lines.push('项目：「' + (project.title || '未命名') + '」');
  if (project.brief) lines.push('需求：' + project.brief);
  if (project.audience) lines.push('目标观众与观看场景：' + project.audience);
  if (project.pipelineId) lines.push('管线：' + project.pipelineId);

  const stages = project.stages || [];
  const cur = stages.find((s) => s.stageId === project.currentStageId);
  if (cur) {
    lines.push('当前工序：' + cur.stageId + '（' + (cur.status || '') + '）');
  }

  // 前序验收记录（含被延后的建议项）
  const reviews = stages.filter((s) => s.review && s.review.verdict);
  if (reviews.length > 0) {
    lines.push('前序验收记录：');
    for (const r of reviews) {
      const must = (r.review.mustFix || []).join('；');
      const sugg = (r.review.suggestions || []).join('；');
      let line = '· ' + r.stageId + '：' + r.review.verdict;
      if (must) line += '｜必修：' + must;
      if (sugg) line += '｜建议：' + sugg;
      lines.push(line);
    }
  }

  if (project.needUserVerdict) {
    lines.push('注意：本项目已触发连续回退升级，正在等待用户裁决，请勿继续推进当前工序。');
  }

  return lines.join('\n');
}
