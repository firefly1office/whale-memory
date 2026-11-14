# DSH 适配示例：dsh-whale-memory

一个最小可用的 DSH skill 包，把 `whale-memory` 的命令行交给 DSH 的 agent 调用。

## 结构

```
dsh-whale-memory/
  package.json
  skills/whale-memory/
    SKILL.md              skill 说明（frontmatter: name + description）
    scripts/
      memory-cli.mjs      CLI
      core/lib/*.js       记忆内核（纯 ESM）
```

## 安装（两种）

**A. 直接放 skill 目录（最简单）**

把 `skills/whale-memory` 整个复制到你的 DSH skills 目录，重启后应该能看到 `whale-memory` 这个 skill。

**B. 当成本地 npm 包装**

```bash
cd dsh-whale-memory
npm i /path/to/dsh-whale-memory      # 或放进 profile 的 node_modules
```

## 用之前设数据目录

```bash
export WHALE_DATA_DIR=/path/to/data     # Linux/macOS
set WHALE_DATA_DIR=D:\path\to\data      # Windows
```

不设就用当前目录下的 `data/`。

## 自检

```bash
cd skills/whale-memory/scripts
node memory-cli.mjs write --text "试一条" --feeling "平静"
node memory-cli.mjs read --limit 1
```

看到 `{"ok": true...}` 就通了。

## 它不会自动做的事

- 不会自己往提示词里塞记忆——SKILL.md 告诉 agent 什么时候该调 `memory` / `recall`
- 不会自己定时——醒来块和「自己的时间」要你的 DSH 定时任务来触发
- 不包含任何个人数据

## 如果 DSH 的 skill 格式不一样

`SKILL.md` 的 frontmatter 只有 `name` 和 `description` 两个字段，这是最常见的形式。
如果你的 DSH 版本要求别的字段（比如 `tools`、`entry`），只改 SKILL.md 的头部即可，脚本不用动。