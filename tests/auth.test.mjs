import test from "node:test";
import assert from "node:assert/strict";
import { resolveCallerAgentId, decideGateAccess, assertStageGate } from "../lib/auth.js";

const proj = {
  stages: [
    { stageId: "script", owner: "bianju", status: "进行中" },
    { stageId: "brief", owner: "daoyan", status: "进行中" },
    { stageId: "deliver", owner: "zhizuo", status: "待验" },
  ],
  threads: { bianju: "s-bianju", daoyan: "s-daoyan", zhizuo: "s-zhizuo" },
};

test("resolveCallerAgentId: 按会话反查工位 agent", () => {
  assert.equal(resolveCallerAgentId(proj, "s-bianju"), "bianju");
  assert.equal(resolveCallerAgentId(proj, "s-daoyan"), "daoyan");
  assert.equal(resolveCallerAgentId(proj, "nope"), null);
  assert.equal(resolveCallerAgentId(proj, null), null);
  assert.equal(resolveCallerAgentId({}, "x"), null);
});

test("decideGateAccess: report 仅本阶段执行者可申报", () => {
  const r = (caller) => decideGateAccess({ project: proj, stageId: "script", action: "report", callerAgentId: caller, directorAgentId: "daoyan" });
  assert.equal(r("bianju").ok, true);
  assert.equal(r("zhizuo").ok, false);
  assert.equal(r("daoyan").ok, false);
  assert.equal(r(null).ok, true); // 页面/未知放行
});

test("decideGateAccess: approve/reject 仅导演可验收；导演自产豁免", () => {
  const g = (caller, stageId) => decideGateAccess({ project: proj, stageId, action: "approve", callerAgentId: caller, directorAgentId: "daoyan" });
  assert.equal(g("daoyan", "script").ok, true);
  assert.equal(g("zhizuo", "script").ok, false);
  assert.equal(g("bianju", "script").ok, false);
  assert.equal(g("daoyan", "brief").ok, true);
  assert.equal(g("zhizuo", "brief").ok, false);
  assert.equal(g(null, "script").ok, true);
  const j = (caller, s) => decideGateAccess({ project: proj, stageId: s, action: "reject", callerAgentId: caller, directorAgentId: "daoyan" });
  assert.equal(j("daoyan", "deliver").ok, true);
  assert.equal(j("zhizuo", "deliver").ok, false);
});

test("decideGateAccess: 自定义导演 id 与缺失阶段兜底", () => {
  const r = (caller) => decideGateAccess({ project: proj, stageId: "script", action: "approve", callerAgentId: caller, directorAgentId: "myDirector" });
  assert.equal(r("myDirector").ok, true);
  assert.equal(r("daoyan").ok, false);
  const miss = decideGateAccess({ project: proj, stageId: "ghost", action: "approve", callerAgentId: "daoyan", directorAgentId: "daoyan" });
  assert.equal(miss.ok, true);
  assert.equal(miss.reason, "no-stage");
});

test("assertStageGate: 会话映射 + 宽容降级 + 越权拒绝", async () => {
  const mkCtx = (sessionId) => ({ sessionId, config: { get: async () => undefined }, log: { warn: () => {} } });
  const ok = await assertStageGate(mkCtx("s-daoyan"), proj, "script", "approve");
  assert.equal(ok.ok, true);
  const den = await assertStageGate(mkCtx("s-zhizuo"), proj, "script", "approve");
  assert.equal(den.ok, false);
  assert.match(den.error, /无权验收/);
  const unver = await assertStageGate(mkCtx("s-unknown"), proj, "script", "approve");
  assert.equal(unver.ok, true); // 未知会话宽容放行
  const repDen = await assertStageGate(mkCtx("s-zhizuo"), proj, "script", "report");
  assert.equal(repDen.ok, false);
  assert.match(repDen.error, /无权申报/);
});