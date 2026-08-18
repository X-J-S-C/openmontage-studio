// OpenMontage Studio - 状态机规则 (T4)
// 职责：推进/回退/申报的合法性校验与状态转移，纯函数，不直接读写文件
// 规则来源：设计稿 v0.3（导 M2/M3、制 6、枢 T4）
//  - 工位 agent 只能申报"待验"；验收人（导/晟）才能推进或回退
//  - 回退可跨级，目标阶段工件 version+1
//  - 同一阶段连续回退 2 次 → needUserVerdict（升级晟裁决）

export const STATUS = {
  PENDING: '待料',
  ACTIVE: '进行中',
  READY: '待验',
  DONE: '已交付',
};

export function findStage(project, stageId) {
  return (project.stages || []).find((s) => s.stageId === stageId);
}

export function stageIndex(project, stageId) {
  return (project.stages || []).findIndex((s) => s.stageId === stageId);
}

export function touch(project) {
  project.updatedAt = new Date().toISOString();
}

// 工位申报：阶段 → 待验
export function reportReady(project, stageId) {
  const stage = findStage(project, stageId);
  if (!stage) return { ok: false, error: '阶段不存在: ' + stageId };
  if (stage.status === STATUS.DONE) {
    return { ok: false, error: '已交付阶段不能重新申报' };
  }
  stage.status = STATUS.READY;
  touch(project);
  return { ok: true, stage };
}

// 验收通过：当前阶段 → 已交付，下一阶段 → 进行中
export function approve(project, stageId, review) {
  const idx = stageIndex(project, stageId);
  if (idx < 0) return { ok: false, error: '阶段不存在: ' + stageId };
  const stage = project.stages[idx];
  if (stage.status !== STATUS.READY) {
    return { ok: false, error: '只有待验阶段可验收通过（当前: ' + stage.status + '）' };
  }
  stage.status = STATUS.DONE;
  stage.review = {
    verdict: '通过',
    mustFix: [],
    suggestions: (review && review.suggestions) || [],
    at: new Date().toISOString(),
  };
  stage.rejectStreak = 0;
  const next = project.stages[idx + 1];
  if (next) {
    next.status = STATUS.ACTIVE;
    project.currentStageId = next.stageId;
  }
  project.needUserVerdict = false;
  touch(project);
  return { ok: true, approvedStageId: stageId, nextStageId: next ? next.stageId : null };
}

// 验收不过：回退到指定阶段（可跨级），目标阶段工件 version+1，连续回退计数+1
// streak 记在被退回的工序阶段（stageId），而非回退目标阶段
// 修复原因：streak 原先记在 target 上，但 brief 必须 approve 后 script 才能重新申报
//   approve 会重置 target 的 streak，导致连续退回计数永远到不了 2
export function reject(project, stageId, targetStageId, review) {
  const idx = stageIndex(project, stageId);
  const targetIdx = stageIndex(project, targetStageId);
  if (idx < 0) return { ok: false, error: '阶段不存在: ' + stageId };
  if (targetIdx < 0) return { ok: false, error: '回退目标阶段不存在: ' + targetStageId };
  if (targetIdx >= idx) {
    return { ok: false, error: '回退目标必须早于当前验收阶段' };
  }

  const stage = project.stages[idx];
  stage.status = STATUS.DONE;
  stage.review = {
    verdict: '退回',
    mustFix: (review && review.mustFix) || [],
    suggestions: (review && review.suggestions) || [],
    at: new Date().toISOString(),
  };
  // streak 记在被退回的工序阶段（如 script），approve 该阶段时才重置
  stage.rejectStreak = (stage.rejectStreak || 0) + 1;
  if (stage.rejectStreak >= 2) {
    project.needUserVerdict = true;
  }

  // 回退：目标阶段重新开工（version+1），其后的阶段全部重置为待料
  const target = project.stages[targetIdx];
  target.status = STATUS.ACTIVE;
  target.artifacts = (target.artifacts || []).map((a) => ({
    ...a,
    version: (a.version || 1) + 1,
  }));
  for (let i = targetIdx + 1; i < project.stages.length; i++) {
    project.stages[i].status = STATUS.PENDING;
  }
  project.currentStageId = targetStageId;
  touch(project);
  return {
    ok: true,
    rejectedStageId: stageId,
    fallbackStageId: targetStageId,
    rejectStreak: stage.rejectStreak,
    needUserVerdict: !!project.needUserVerdict,
  };
}
