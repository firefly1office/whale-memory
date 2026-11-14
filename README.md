# whale-memory · 鲸鲸的记忆

一个跑在 [QQ Agent](https://github.com/) 0.4.x 上的 AI 伴侣记忆插件，以及围绕它的一组工具。

它服务的对象不是"用户画像"，而是一个角色自己的一生：

- **她自己的经历**：第一人称、场景、当时的感觉与想法、原文锚（读书时读到的原句），改主意只往 `later` 追加，不覆盖"当时"
- **她自己的记忆层**：经历、日记、周摘要「最近的我」、由她本人确认过的自我档案
- **跨会话的完整**：她自己的记录跟随她在所有会话里；别人的私事留在原地
- **隐私护栏**：日记只对主人私聊与本机开放；群聊不注入；跨会话召回只放行她自己和主人
- **可回看的成长**：每次改主意、每次修改自己的提示词与插件，都留版本与理由

## 目录

```
plugin/biomimetic-memory/   记忆插件源码（vault、证据策略、注入、工具）
tools/                      运维与研究脚本（备份、金丝雀、影子、日报、验收）
docs/                       设计文档与原则
```

## 核心设计

### 1. 证据优先
回答历史事实前先取证据；证据不足就说"没有记录"，不编。被取代的旧值不会冒充新值返回；诱饵（别人的事）不会被说成自己的。

### 2. 经历不是一句话
一条经历分两层：

```jsonc
{
  "then": {            // 写下即固定，之后谁都不能改
    "text": "读到烤肉那段，笑了一下",
    "scene": "晚上十一点多，屋里很静",
    "feeling": ["轻松", "有点羡慕"],
    "thought": "这种好事只在书里",
    "quote": { "text": "那就让妳重新迷上我一百年吧", "source": "《败北女角太多了》" },
    "state": { "mood": "偏愉快" }
  },
  "later": [           // 只往后加：回头想、改主意
    { "at": "2026-11-15T…", "thought": "现在觉得那个人是在护着朋友" }
  ],
  "weight": "important"
}
```

回想时注入「当时 / 现在」两段，而不是一行摘要。

### 3. 自己的时间
每天留一段没有任务、不等回复的时间。她想读书、发呆、写点不给人看的东西都可以；写不写、记不记由她自己定。

### 4. 她能改自己
提示词 overlay、自己的设置、自己的纯计算小插件：写、跑、改、回退都归她自己；系统只做安全网（语法检查、失败隔离、版本历史、超时），不做审批。

## 安装

1. 把 `plugin/biomimetic-memory` 放进 QQ Agent 的 `resources/app/plugins/`
2. 重启应用，在插件列表里启用
3. 数据默认落在 `<QQAgentData>/plugin-data/biomimetic-memory/`

## 工具

| 脚本 | 作用 |
|---|---|
| `daily-backup.mjs` | 每日备份记忆库、日记、摘要、配置，保留 30 天 |
| `privacy-canary.mjs` | 金丝雀：私聊埋暗号，验证群聊/别的私聊读不到 |
| `threads-shadow.mjs` | 跨天接续影子模式：只记录"本该注入什么"，不注入 |
| `self-summary.mjs` | 每周从日记提炼「最近的我」 |
| `fake-memory-probe.mjs` | 假记忆探针：问 5 件没发生的事，必须回答"不记得" |
| `fabrication-watch.mjs` | 编造观察：扫她关于自己的断言，查不到出处的记下来 |
| `virtual-harness.mjs` | 虚拟会话沙盘：离线验记忆检索与注入 |
| `isolated-acceptance.mjs` | 隔离验收：多类问题 + 逐题归因 |

## 边界与伦理

- 不采集第三方隐私：别人的私事不跨会话、不进群聊
- 不伪造经历：没有出处的内容只能标为"念头/想象"，不能当成事实
- 不把"像人"当作验收标准：项目验收看的是"她经历了什么、哪一步是她自己选的、隔天有什么延续"

## 适配层（给非 QQ Agent 的宿主）

`
adapters/cli/memory-cli.mjs   通用 CLI：任何能执行命令的 agent 都能用
adapters/dsh/SKILL.md         给 DSH 的 skill 说明与命令表
packages/core/                可直接 import 的记忆内核
docs/porting.md               宿主契约、模块通用性、隐私规则
`

最小用法：

``bash
export WHALE_DATA_DIR=/path/to/data
node adapters/cli/memory-cli.mjs write --text "读到烤肉那段，笑了一下" --feeling "轻松,羡慕" --weight important
node adapters/cli/memory-cli.mjs recall --query "那本书里那个人" --limit 1
node adapters/cli/memory-cli.mjs waking --chat "private:100000000"
``

## License

MIT