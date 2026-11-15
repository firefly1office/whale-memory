## 这个 PR 做了什么

一句话。

## 为什么

关联 issue（没有就写背景）。

## 怎么验证的

```sh
node --test tests/public-cli.test.mjs tests/core-memory.test.mjs tests/core-aux.test.mjs
node tools/privacy-canary.mjs
node tools/eval-recall.mjs
```

- [ ] 本地全跑过，贴了结果
- [ ] 涉及数据格式：写明向后兼容方式
- [ ] 涉及隐私：说明读取范围和调用者校验

## 检查

- [ ] 没有提交真实聊天内容、真人信息、真实会话编号、本机绝对路径
- [ ] 没有提交 key / token / cookie
- [ ] `then` 没有被覆盖，`later` 只追加
- [ ] 中文文档改了的话，英文版也同步（或说明为什么没有）