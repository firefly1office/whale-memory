# 备份与搬家

她的一条经历在磁盘上可能由三个文件拼成。只拷 `self-experience.jsonl`，会丢掉后记和想起次数。

## 要备份什么

```
<data>/plugin-data/biomimetic-memory/
  self-experience.jsonl     当时写下的（then）
  later-events.jsonl        后来追加的想法（0.5.0 起）
  recall-events.jsonl       想起的次数（0.5.0 起）
  autobiography.jsonl       日记
  self-settings.json        她自己的设置
  prompt-overlay/           她改过的提示词
```

`<data>` 是 QQ Agent 的数据根目录，通常是 `C:\Users\<你>\QQAgentData`。

## 备份

```powershell
$src = "$env:USERPROFILE\QQAgentData\plugin-data\biomimetic-memory"
$dst = "D:\备份\她的记忆-$(Get-Date -Format yyyyMMdd-HHmm)"
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item "$src\*" $dst -Recurse -Force
```

会在运行中写入的文件（经历、事件、日记）建议先停掉宿主，或者接受“少最后几条”的误差。设置和提示词很小，随时拷都行。

## 恢复

1. 停掉 QQ Agent
2. 把备份文件拷回 `<data>/plugin-data/biomimetic-memory/`
3. 启动，打开一次她的记忆界面，确认条数与备份时一致
4. 用 CLI 读一条试试：

```sh
node adapters/cli/memory-cli.mjs read --data=<data> --limit 3
```

## 校验

读回来的 `recalls` 和 `later` 是合并后的结果。如果迁移过旧数据，确认：

- `self-experience.jsonl` 里没有残留的 `later` 字段（迁移后应清掉）
- `later-events.jsonl` 的条数 = 所有经历的后记总数
- `recall-events.jsonl` 的条数 = 所有经历的 `recalls` 之和

对不上就先别删旧备份。

## 换机器

整套目录可以原样搬。数据里没有绑定机器的东西；路径由宿主传进来，不写死在文件里。搬到新机器后，只需要让新宿主指向新的数据根目录。