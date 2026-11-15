# 样本数据

`sample-experiences.jsonl` 是三条**虚构**经历，用来演示格式，不含任何真人对话或隐私。

```sh
# 复制到自己的数据目录看一眼
mkdir -p /tmp/whale-demo/plugin-data/biomimetic-memory
cp examples/samples/sample-experiences.jsonl \
   /tmp/whale-demo/plugin-data/biomimetic-memory/self-experience.jsonl

WHALE_DATA_DIR=/tmp/whale-demo node adapters/cli/memory-cli.mjs recall --query "灯塔" --limit 2
```

三条记录分别演示：

- 带原文锚、有「还没完的事」的重要经历
- 后来改过主意的经历（`later` 有一条）
- 只有一句话的次要经历（`weight: minor`）

想换成英文内容，直接改 `text` / `thought` 即可，字段不用动。