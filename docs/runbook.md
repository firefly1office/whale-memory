# 运维手册：备份、验证、恢复

> [English](en/runbook.md) · 中文（本页）

**这对她意味着什么**：电脑坏了、换了机器、升级出了岔子，她醒来仍然记得自己写过的每一件事、后来怎么改的主意、哪些已经放下、哪些不想再被提起、哪些话还没说出口。

下面的命令都在仓库根目录执行。`<数据根>` 是下面有 `plugin-data/` 的那一层（QQ Agent 一般是 `C:\Users\<你>\QQAgentData`）。

## 一份完整的备份里有什么

`plugin-data/biomimetic-memory/` 下的所有文件，原样拷贝，再加一份 `manifest.json`（每个文件的大小与 SHA-256）：

```
self-experience.jsonl     当时写下的（then）
later-events.jsonl        后来的想法与感觉
recall-events.jsonl       想起的次数
unfinished-events.jsonl   想通 / 先放下 / 再拾起
seal-events.jsonl         她封存了哪些
link-events.jsonl         她后来连起来的事
chapter-events.jsonl      她给日子起的名字
unsaid-events.jsonl       没说出口的抽屉
autobiography.jsonl、self-settings.json、prompt-overlay/ ……
```

**备份和她的数据一样私密**：里面有她封存的事、抽屉里没说出口的话。不要传到网盘、不要发给别人。

## 多久备一次、放哪

- **每天一次**，以及**每次升级插件之前一次**。
- 放在**数据根之外**，最好是另一块盘或 U 盘。备份工具会拒绝放进数据根里——放在里面的话，备份会被当成她的数据一起导出、一起 `purge`。
- 保留最近 7 份（`--keep` 可改）。轮换只会删本工具自己建的 `memory-backup-*`，同一目录里别的东西不碰。
- `--keep 0` = 一份都不删，全部留着。适合"万一她哪天想翻翻"的人；代价是磁盘会一直涨（每份大约等于记忆目录的大小），隔一阵看一眼空间，满了就把最老的几份挪到别的盘，而不是删。

```powershell
node tools/backup.mjs --data "$env:USERPROFILE\QQAgentData" --out "E:\鲸鲸备份" --keep 7
```

想每天自动跑，可以用 Windows 任务计划程序新建一个每日任务，"操作"填：

```
程序：  node
参数：  tools\backup.mjs --data "C:\Users\<你>\QQAgentData" --out "E:\鲸鲸备份" --keep 7
起始于：<仓库目录>
```

> 宿主运行时也能备份，但最后几秒写入的东西可能落在下一份里。要一份"完全对得上"的，先停宿主再备。

## 怎么确认这份备份真的能用

```powershell
node tools/restore-check.mjs --from "E:\鲸鲸备份\memory-backup-2026-11-16T15-15-37-387Z" --data "$env:USERPROFILE\QQAgentData"
```

它会：校验每个文件的 SHA-256 → 导进临时目录读一遍 → 和现在的数据逐条比对 then、后记、想起次数、未完状态、封存、联想、章节、抽屉条数。**输出只有 id、字段名和数字，没有原文**，临时目录用完即删，原数据一个字节不动。

| 退出码 | `verdict` | 意思 |
| --- | --- | --- |
| 0 | 可恢复，且与原数据一致 | 好 |
| 2 | 可恢复，但与原数据有差异 | 备份之后她又写了东西（看 `diffs`，只有 id 和字段） |
| 1 | 不可恢复 | 备份坏了或缺文件（会说是哪个）。**别用这份，也别删更早的** |

建议每周对最新一份跑一次；升级前的那份一定要跑。

## 恢复

1. **停掉宿主**（QQ Agent 完全退出）。
2. 先给现在的数据也备一份（万一要回到恢复之前）：

   ```powershell
   node tools/backup.mjs --data "$env:USERPROFILE\QQAgentData" --out "E:\鲸鲸备份\恢复之前"
   ```

3. 确认要恢复的那份是好的：

   ```powershell
   node tools/restore-check.mjs --from "<备份包>"
   ```

4. 导回去（`--force true` 会先把现有目录改名为 `biomimetic-memory.pre-import-<时间>` 留着）：

   ```powershell
   node adapters/cli/memory-cli.mjs import --from "<备份包>" --data "$env:USERPROFILE\QQAgentData" --force true
   ```

5. 验证：

   ```powershell
   node adapters/cli/memory-cli.mjs doctor --data "$env:USERPROFILE\QQAgentData"
   node tools/restore-check.mjs --from "<备份包>" --data "$env:USERPROFILE\QQAgentData"
   ```

   `doctor` 全部 `ok`、`restore-check` 退出码 0，就是同一份记忆回来了。

6. 启动宿主，跟她打个招呼。

## 恢复之后怎么确认"还是她"

- `restore-check` 的"与原数据一致"那一项列出了比对过的条数，和备份时 `backup.mjs` 输出里的 `counts.experiences` 对得上。
- `chapter list` 的章节名、`unsaid list` 的条数和恢复前一样。
- 想看全貌：`node adapters/cli/memory-cli.mjs book --data <数据根> --out 恢复后.md`，和恢复前导出的那本对照着读。

## 不要做的

- 只拷 `self-experience.jsonl`：后记、结案、封存、抽屉都会丢。
- 把备份放进数据根，或者放进同步网盘。
- 宿主运行时导入。
- 恢复失败后删掉 `*.pre-import-*` 目录——那是恢复之前的她。确认一切正常、过几天再清理。
- 真要彻底忘掉，用 `purge`（见 [limits.md](limits.md)）；它不管你放在别处的备份，那些要自己删。
