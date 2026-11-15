---
name: 缺陷报告 / Bug report
about: 数据读不回来、跨会话看到不该看的东西、CLI 行为不对
title: "[bug] "
labels: bug
---

**发生了什么**
一两句话说清楚。

**期望是什么**
你原本以为会发生什么。

**复现步骤**
```sh
# 贴最小可复现命令
```

**环境**
- 系统：Windows / macOS / Linux
- Node 版本：
- 用的是哪条路径：`adapters/cli` / `packages/core` / `examples/dsh-plugin` / `plugin/biomimetic-memory`
- 版本或 commit：

**数据相关（重要）**
如果是“记录读不回来”：
- 出问题的文件是 `self-experience.jsonl` 还是 `autobiography.jsonl`
- 报错原文
- **不要贴真实聊天内容**；用虚构样本或字段名描述结构即可

**你试过什么**
例如：备份后换目录重放、清空临时库重跑。