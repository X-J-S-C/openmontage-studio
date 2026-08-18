// OpenMontage Studio - 验收门角色鉴权（安全线）
// 领域规则：
//  - 工位 agent 只能申报（report）自己执行的阶段
//  - 只有验收人（导演 agent，或在页面操作的用户）能验收通过/回退（approve/reject）
// 本模块只判定不改状态机；tools/* 在入口调用；页面侧由用户在界面操作（另走宿主 principal）。
// 宽容降级：当调用会话无法反查身份（页面/用户/宿主未注入会话）时放行并留日志，避免卡死既有流程。

import { getConfig, DEFAULT_AGENTS } from "./config.js";

// 从 project.threads（{agentId: sessionId} 或 {agentId:{sessionId,...}}）按会话反查调用方 agent
export function resolveCallerAgentId(project, sessionId) {
  if (!project || !sessionId) return null;
  const threads = project.threads && typeof project.threads === "object" ? project.threads : {};
  const keys = Object.keys(threads);
  for (const agentId of keys) {
    const v = threads[agentId];
    const sid = v && typeof v === "object" ? (v.sessionId || (v.sessionRef && v.sessionRef.sessionId) || null) : v;
    if (sid === sessionId) return agentId;
  }
  return null;
}

// 阶段的执行 owner（已映射为 agent id）
export function stageOwnerAgent(stage) {
  return stage && stage.owner ? stage.owner : null;
}

// 判定一次验收门操作（纯函数，便于单测）
// action: "report" | "approve" | "reject"
// callerAgentId: 调用方 agent id；null/空 = 页面/用户或未知（放行 + caller-unverifiable）
export function decideGateAccess({ project, stageId, action, callerAgentId, directorAgentId }) {
  const stages = Array.isArray(project && project.stages) ? project.stages : [];
  const stage = stages.find((s) => s.stageId === stageId);
  if (!stage) return { ok: true, reason: "no-stage", role: null }; // 交状态机兜底"阶段不存在"

  if (!callerAgentId) return { ok: true, reason: "caller-unverifiable", role: null };

  const owner = stageOwnerAgent(stage);

  if (action === "report") {
    if (owner && callerAgentId !== owner) {
      return { ok: false, reason: "report-forbidden", role: "owner", owner };
    }
    return { ok: true, reason: "report-ok", role: "owner" };
  }

  // approve / reject：验收人 = 导演
  const director = directorAgentId || DEFAULT_AGENTS.director;
  if (callerAgentId !== director) {
    // 豁免：阶段 owner 即导演（如 brief 段），导演对自己的产出有验收权
    if (!(owner && callerAgentId === owner && owner === director)) {
      return { ok: false, reason: "gate-forbidden", role: "director", director };
    }
  }
  return { ok: true, reason: "gate-ok", role: "director" };
}

// 工具层入口：加载配置并判定；失败返回 { ok:false, error }，成功 { ok:true }
export async function assertStageGate(ctx, project, stageId, action) {
  let cfg = null;
  try {
    cfg = await getConfig(ctx);
  } catch { /* 配置失败用默认值 */ }
  const directorId = (cfg && cfg.agents && cfg.agents.director) || DEFAULT_AGENTS.director;
  const sessionId = ctx && (ctx.sessionId || (ctx.sessionRef && ctx.sessionRef.sessionId));
  const callerId = sessionId ? resolveCallerAgentId(project, sessionId) : null;
  const gate = decideGateAccess({ project, stageId, action, callerAgentId: callerId, directorAgentId: directorId });

  if (gate.ok) {
    if (gate.reason === "caller-unverifiable") {
      try { ctx && ctx.log && ctx.log.warn && ctx.log.warn("om-studio stage access unverifiable", { action, stageId, hasSession: Boolean(sessionId) }); } catch { /* log 失败不影响 */ }
    }
    return { ok: true };
  }

  const who = callerId || "(未知会话)";
  if (action === "report") {
    return { ok: false, error: "无权申报：阶段「" + stageId + "」由「" + (gate.owner || "-") + "」工位执行，当前调用方 agent=" + who + "，越权调用已拒绝。" };
  }
  return { ok: false, error: "无权验收：「" + stageId + "」的验收人应为导演工位「" + gate.director + "」，当前调用方 agent=" + who + "，越权调用已拒绝。（页面操作可改由你在界面完成）" };
}