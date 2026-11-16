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

```
<你的 DSH skills 目录>/whale-memory/scripts/memory-cli.mjs
```

**B. 从宿主项目安装本地包**

```bash
# 在 DSH 加载插件的宿主项目目录运行，路径指向克隆的仓库
npm install /path/to/whale-memory/examples/dsh-plugin/dsh-whale-memory
```

Windows 上这可能会装成指回克隆仓库的链接。实际入口是：

```
<宿主项目>/node_modules/dsh-whale-memory/skills/whale-memory/scripts/memory-cli.mjs
```

## 数据目录：必须显式指定

**不要把数据放在 skill 目录、`node_modules` 或仓库克隆里。** 删克隆、重装 skill、升级依赖，都可能把记忆一起带走；这些目录又常被 `.gitignore` 忽略，`git status` 看不出来。

先定一个仓库外的目录：

```powershell
$DATA = "$env:LOCALAPPDATA\whale-memory-demo"     # 或者任何你希望长期保留的位置
```

之后每条命令都带 `--data "$DATA"`：

```sh
node memory-cli.mjs doctor --data "$DATA"
```

也可以设环境变量（不设时 CLI 会退回当前目录下的 `data/`，**自检时不要依赖这个默认值**）：

```powershell
$env:WHALE_DATA_DIR = $DATA
```

## 自检

先按安装方式选 `$CLI`：

```powershell
# A：复制 skill
$CLI = "<你的 DSH skills 目录>\whale-memory\scripts\memory-cli.mjs"
# B：宿主项目 npm 安装
$CLI = "<宿主项目>\node_modules\dsh-whale-memory\skills\whale-memory\scripts\memory-cli.mjs"
```

然后逐条执行（每条都带 `--data`）：

```powershell
node $CLI doctor --data $DATA
node $CLI write --text "试一条" --unfinished "想知道明天会不会下雨" --data $DATA
node $CLI read --limit 1 --data $DATA
```

看到 `{"ok": true...}` 就通了。记下 `read` 里的 id，试一次“想通”：

```powershell
node $CLI unfinished --id <id> --state done --data $DATA
node $CLI read --limit 1 --data $DATA   # unfinishedState.choice 应为 done
```

“第二天第一次醒来”：**当天跑不会有内容**，因为昨天确实没有记录。

```powershell
node $CLI waking --chat "local:owner" --peek true --data $DATA
```

`--peek true` 表示只预览、不占当天的额度；真正的次日效果要第二天才看得到。想现在就看重启后的效果，用仓库里的 [`examples/first-day/`](../../first-day/)：它会把时钟推到次日，再打印醒来块和翻读结果。

## 确认数据没有落进仓库

```powershell
git -C "<仓库克隆>" status --ignored --short
```

不应该出现 `examples/dsh-plugin/dsh-whale-memory/skills/whale-memory/scripts/data/`。如果出现，说明某条命令漏了 `--data`，把那个目录删掉，按上面的命令重来。

## 它不会自动做的事

- 不会自己往提示词里塞记忆——SKILL.md 告诉 agent 什么时候该调 `memory` / `recall`
- 不会自己定时——醒来块和「自己的时间」要你的 DSH 定时任务来触发
- 不包含任何个人数据

## 如果 DSH 的 skill 格式不一样

`SKILL.md` 的 frontmatter 只有 `name` 和 `description` 两个字段，这是最常见的形式。
如果你的 DSH 版本要求别的字段（比如 `tools`、`entry`），只改 SKILL.md 的头部即可，脚本不用动。