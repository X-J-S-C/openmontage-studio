# OpenMontage Studio · 测试与验证

零依赖，用 Node 内置测试器（Node >= 18，实测 v24）。

## 运行

语法门（全仓 JS）：
  node --check lib/*.js tools/*.js routes/*.js assets/app.js assets/sidebar.js

回归测试（沙箱内 node --test 子进程被 EPERM 时，逐文件进程内运行）：
  node tests/flow.test.mjs
  node tests/xss-audit.mjs
  node tests/artifact-guard.test.mjs
  node tests/auth.test.mjs

## 覆盖

- flow.test.mjs         状态机：推进/回退/跨级/streak 升级到 needUserVerdict/非法转移负例
- xss-audit.mjs         A0 存储型 XSS 回归守卫：注入值安全化(</script>、U+2028/29、<!--) + studio.js 集成断言(三处注入点必须用 jsSafe)
- artifact-guard.test.mjs 路径校验 sanitizeRelPath + 工件登记 registerArtifact(版本次增/防穿越)

## 说明

- xss-audit 的"前置证明"用例在修复前 FAIL、修复后 PASS，作为 A0 回归护栏。
- sanitizeRelPath 将 a//b 归一为 a/b(split 折叠连续分隔符)：安全，与注释措辞略有出入（见 artifact-guard 用例注释）。