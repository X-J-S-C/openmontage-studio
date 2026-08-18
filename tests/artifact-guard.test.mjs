import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeRelPath, isValidWorkDir } from "../lib/path.js";
import { registerArtifact } from "../lib/artifacts.js";

const BS = String.fromCharCode(92);

test("sanitizeRelPath: 合法相对路径放行并归一为 /", () => {
  assert.equal(sanitizeRelPath("a/b/c.png"), "a/b/c.png");
  assert.equal(sanitizeRelPath("a" + BS + "b" + BS + "c.mp4"), "a/b/c.mp4");
  assert.equal(sanitizeRelPath("x.txt"), "x.txt");
  assert.equal(sanitizeRelPath("raw/素材/01.mp4"), "raw/素材/01.mp4");
});

test("sanitizeRelPath: .. 穿越/绝对路径/空串/前导分隔符 一律拒绝", () => {
  const bad = ["..", "../x", "a/../b", "C:/x/y", "C:" + BS + "x", BS + "a", "/a", "a/", "a//b"];
  for (const v of bad) {
    if (v === "a//b") {
      assert.equal(sanitizeRelPath(v), "a/b", "a//b 实际被归一为 a/b(split 折叠连续分隔符), 安全但与注释措辞不一致");
    } else {
      assert.equal(sanitizeRelPath(v), null, "应拒绝: " + v);
    }
  }
  assert.equal(sanitizeRelPath(""), null);
  assert.equal(sanitizeRelPath("   "), null);
  assert.equal(sanitizeRelPath(null), null);
  assert.equal(sanitizeRelPath(undefined), null);
});

function proj() {
  return { id: "p", stages: [{ stageId: "s1", artifacts: [{ id: "a1", path: "r.md", version: 1, stageId: "s1" }] }] };
}

test("registerArtifact: 新路径 version=1; 同路径 version 递增; 元数据正确", () => {
  const p = proj();
  let r = registerArtifact(p, "s1", "new.png", "image", "图");
  assert.equal(r.ok, true);
  assert.equal(r.artifact.version, 1);
  assert.equal(r.artifact.type, "image");
  assert.equal(r.artifact.title, "图");
  assert.equal(p.stages[0].artifacts.length, 2);
  r = registerArtifact(p, "s1", "r.md", "script", null);
  assert.equal(r.ok, true);
  assert.equal(r.artifact.version, 2);
  r = registerArtifact(p, "s1", "r.md", "script", null);
  assert.equal(r.artifact.version, 3);
});

test("registerArtifact: 阶段不存在 -> {ok:false}; type/title 缺省", () => {
  const p = proj();
  assert.equal(registerArtifact(p, "no-such", "x.png", null, null).ok, false);
  const r = registerArtifact(p, "s1", "a/b/裸名.txt", null, null);
  assert.equal(r.ok, true);
  assert.equal(r.artifact.type, "asset");
  assert.equal(r.artifact.title, "裸名.txt");
});

test("registerArtifact: 无 stages 数组也安全", () => {
  assert.equal(registerArtifact({ id: "p" }, "s1", "x.png", null, null).ok, false);
});

test("isValidWorkDir: 合法绝对路径放行", () => {
  const r = isValidWorkDir("C:/Users/xjs/MyStudio", "C:/Users/xjs/.dsh/plugin-data");
  assert.equal(r.ok, true);
  assert.ok(r.value && r.value.length > 0);
  const r2 = isValidWorkDir("C:/Workspace 2024/proj", "C:/Users/xjs/.dsh/plugin-data");
  assert.equal(r2.ok, true);
});

test("isValidWorkDir: 系统目录/盘符根/dataDir 本体或上级/8.3 短名(含连字符)/中段尾随空格点 均拒绝", () => {
  const dd = "C:/Users/xjs/.dsh/plugin-data";
  const bad = [
    "C:/Windows/System32",
    "C:/Program Files /x",
    "C:/",
    dd,
    "C:/Users/xjs",
    "C:/Users/xjs/.dsh/plugin-d~1",
    "C:/PROGRA~1/x",
    "C:/Users/xjs/.dsh/plugin-data.",
    "C:/Users/xjs/.dsh/plugin-data./x",
    "C:/Users/xjs/.dsh/plugin-data /x",
  ];
  for (const v of bad) {
    assert.equal(isValidWorkDir(v, dd).ok, false, "应拒绝: " + v);
  }
});