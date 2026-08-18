import test from "node:test";
import assert from "node:assert/strict";
import { STATUS, reportReady, approve, reject, findStage } from "../lib/flow.js";

function makeProject() {
  return {
    id: "p",
    currentStageId: "s1",
    needUserVerdict: false,
    stages: [
      { stageId: "s1", status: STATUS.ACTIVE, artifacts: [], rejectStreak: 0 },
      { stageId: "s2", status: STATUS.PENDING, artifacts: [], rejectStreak: 0 },
      { stageId: "s3", status: STATUS.PENDING, artifacts: [{ id: "a1", path: "deliver.mp4", version: 1 }], rejectStreak: 0 },
    ],
  };
}

test("STATUS 常量齐全", () => {
  assert.deepEqual([STATUS.PENDING, STATUS.ACTIVE, STATUS.READY, STATUS.DONE], ["待料", "进行中", "待验", "已交付"]);
});

test("reportReady: 进行中 -> 待验, 并 touch updatedAt", () => {
  const p = makeProject();
  const r = reportReady(p, "s1");
  assert.equal(r.ok, true);
  assert.equal(findStage(p, "s1").status, STATUS.READY);
  assert.ok(p.updatedAt);
});

test("reportReady: 已交付阶段不可重新申报", () => {
  const p = makeProject();
  findStage(p, "s1").status = STATUS.DONE;
  const r = reportReady(p, "s1");
  assert.equal(r.ok, false);
  assert.match(r.error, /已交付/);
});

test("reportReady: 阶段不存在报错", () => {
  assert.equal(reportReady(makeProject(), "nope").ok, false);
});

test("approve: 仅待验可通过, 推进下一阶段并重置 streak", () => {
  const p = makeProject();
  findStage(p, "s1").status = STATUS.READY;
  // 预置非零 streak 与待裁决标记，验证 approve 真正重置/清空（防 false-pass 空洞）
  findStage(p, "s1").rejectStreak = 2;
  p.needUserVerdict = true;
  const r = approve(p, "s1", { suggestions: ["建议A"] });
  assert.equal(r.ok, true);
  assert.equal(findStage(p, "s1").status, STATUS.DONE);
  assert.equal(findStage(p, "s1").review.verdict, "通过");
  assert.deepEqual(findStage(p, "s1").review.suggestions, ["建议A"]);
  assert.equal(findStage(p, "s1").rejectStreak, 0);
  assert.equal(findStage(p, "s2").status, STATUS.ACTIVE);
  assert.equal(p.currentStageId, "s2");
  assert.equal(p.needUserVerdict, false);
  assert.equal(r.nextStageId, "s2");
});

test("approve: 非待验状态拒绝", () => {
  assert.equal(approve(makeProject(), "s1", {}).ok, false);
});

test("approve: 最后一个阶段, nextStageId 为 null", () => {
  const p = makeProject();
  findStage(p, "s3").status = STATUS.READY;
  const r = approve(p, "s3", {});
  assert.equal(r.ok, true);
  assert.equal(findStage(p, "s3").status, STATUS.DONE);
  assert.equal(r.nextStageId, null);
});

test("reject: 回退使目标重开, 后续重置, 被退阶段记 streak", () => {
  const p = makeProject();
  findStage(p, "s2").status = STATUS.READY;
  const r = reject(p, "s2", "s1", { mustFix: ["重做"] });
  assert.equal(r.ok, true);
  // 被退阶段也在"目标之后"范围内被重置为待料（重新再做），但 review 与 streak 保留（DESIGN 语义）
  assert.equal(findStage(p, "s2").status, STATUS.PENDING);
  assert.equal(findStage(p, "s2").review.verdict, "退回");
  assert.equal(findStage(p, "s2").rejectStreak, 1);
  assert.equal(findStage(p, "s1").status, STATUS.ACTIVE);
  assert.equal(p.currentStageId, "s1");
  assert.equal(p.needUserVerdict, false);
  assert.equal(findStage(p, "s3").status, STATUS.PENDING);
});

test("reject: 目标阶段工件 version+1", () => {
  const p2 = makeProject();
  findStage(p2, "s3").status = STATUS.READY;
  findStage(p2, "s1").artifacts = [{ id: "x", path: "s1/v1.md", version: 1 }];
  const r = reject(p2, "s3", "s1", {});
  assert.equal(r.ok, true);
  assert.equal(findStage(p2, "s1").artifacts[0].version, 2);
});

test("reject: 连续 2 次触发 needUserVerdict(升级主人裁决); 1 次不触发", () => {
  const p = makeProject();
  findStage(p, "s2").status = STATUS.READY;
  reject(p, "s2", "s1", {});
  assert.equal(p.needUserVerdict, false);
  findStage(p, "s2").status = STATUS.READY;
  const r2 = reject(p, "s2", "s1", {});
  assert.equal(r2.ok, true);
  assert.equal(r2.rejectStreak, 2);
  assert.equal(r2.needUserVerdict, true);
});

test("reject: 回退目标不能晚于或等于当前阶段", () => {
  assert.equal(reject(makeProject(), "s2", "s2", {}).ok, false);
  assert.equal(reject(makeProject(), "s1", "s2", {}).ok, false);
});

test("reject: 阶段不存在/目标不存在报错", () => {
  assert.equal(reject(makeProject(), "nope", "s1", {}).ok, false);
  assert.equal(reject(makeProject(), "s2", "nope", {}).ok, false);
});

test("跨级回退: s3 直退 s1, 中间阶段全重置为待料", () => {
  const p = makeProject();
  findStage(p, "s3").status = STATUS.READY;
  reject(p, "s3", "s1", {});
  assert.equal(findStage(p, "s1").status, STATUS.ACTIVE);
  assert.equal(findStage(p, "s2").status, STATUS.PENDING);
  // s3 也在目标之后被重置回待料（重新再做），review 与 streak 保留
  assert.equal(findStage(p, "s3").status, STATUS.PENDING);
  assert.equal(findStage(p, "s3").review.verdict, "退回");
  assert.equal(findStage(p, "s3").rejectStreak, 1);
});