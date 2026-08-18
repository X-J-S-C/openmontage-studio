import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// 复刻仓库 jsSafe 的安全语义（注入值安全化）。用 fromCharCode 构造控制字符与反斜杠，避免转义歧义。
const BS = String.fromCharCode(92);
function jsSafe(obj) {
  return JSON.stringify(obj)
    .replace(/</g, BS + "u003c")
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), BS + "u2028")
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), BS + "u2029");
}

function renderInlineValue(payload, useSafe) {
  const raw = JSON.stringify(payload);
  return useSafe === false ? raw : jsSafe(raw);
}

const MALICIOUS = {
  tag: "</script><script>alert(1)</script>",
  ls: String.fromCharCode(0x2028),
  ps: String.fromCharCode(0x2029),
  comment: "<!--",
};

test("前置证明: JSON.stringify 原样输出会保留裸 </script>（漏洞前提）", () => {
  const raw = JSON.stringify({ title: MALICIOUS.tag });
  assert.ok(raw.includes("</script>"), "JSON.stringify 不转义 </script> 是漏洞前提");
});

test("jsSafe 修复后: 注入值不再含裸 </script>/<script>, 且含转义序列", () => {
  const safe = renderInlineValue({ title: MALICIOUS.tag }, true);
  assert.ok(!safe.includes("</script>"));
  assert.ok(!safe.includes("<script>"));
  assert.ok(safe.includes(BS + "u003c"));
});

test("jsSafe 修复后: U+2028/2029 被转义为字面序列(不再原样出现)", () => {
  const raw = JSON.stringify({ t: MALICIOUS.ls });
  assert.ok(raw.includes(String.fromCharCode(0x2028)), "未修复时原样式含 U+2028");
  const safe = renderInlineValue({ t: MALICIOUS.ls }, true);
  assert.ok(!safe.includes(String.fromCharCode(0x2028)));
  assert.ok(safe.includes(BS + "u2028"));
});

test("jsSafe 修复后: HTML 注释引导 <!-- 不再原样出现", () => {
  const safe = renderInlineValue({ t: MALICIOUS.comment }, true);
  assert.ok(!safe.includes("<!--"));
});

test("集成: studio.js 三处注入点必须用 jsSafe, 不得再裸 JSON.stringify 直插", () => {
  const src = fs.readFileSync(new URL("../routes/studio.js", import.meta.url), "utf8");
  // 泛化：扫描任意 <script>window.* 行，不得有裸 JSON.stringify 直插、必须用 jsSafe（防新增注入点漏检）
  const lines = src.split("\n").filter((ln) => ln.includes("<script>window."));
  assert.ok(lines.length >= 3, "应至少看到 3 个注入点");
  for (const ln of lines) {
    assert.ok(!ln.includes("= ${JSON.stringify("), "不得裸内联 JSON.stringify 直插: " + ln.trim());
    assert.ok(ln.includes("jsSafe("), "注入点必须使用 jsSafe: " + ln.trim());
  }
});