# 借鉴与致谢

这个项目在演进过程中参考过几个同类项目。按许可证分两类写清。

## MIT（可以借鉴实现，留名即可）

### [QiuYeDx/dsh-rugu](https://github.com/QiuYeDx/dsh-rugu)（如故）

- 借鉴内容：**「知道不等于说」的分寸模型**——同一件事按场合、敏感度、来源决定能说 / 说个大概 / 不提，
  以及"公开、收不回的渠道额外审视"的思路。
- 落点：`packages/core/lib/manners.js`、`docs/manners-zh.md`（0.27.0 起，默认关）。
- 说明：实现为本项目自写，未复制其代码。

### [zxl176463834/dsh-emotion-state](https://github.com/zxl176463834/dsh-emotion-state)

- 借鉴内容：四本账（承诺 / 边界 / 拒绝 / 和解）、信任六档、"组合情绪不给名字"等设计（尚未落地）。
- 落点：路线图 T6 / T7。

### [abrahamadams2436-glitch/dsh-xiaoyu-wake](https://github.com/abrahamadams2436-glitch/dsh-xiaoyu-wake)

- 借鉴内容：开局短卡（认人 + 档案位置 + "读不到别编"）、线索表 + 覆盖率门槛 + 频控、落笔欠账、
  `DISCIPLINE.md` 的"可数 / 半可数 / 不可数"三档写法。
- 落点：路线图 T11 / T12 / T13（尚未落地）。

## 自定义许可（只学设计，不抄代码）

### [Yuuyuko-uu/dsh-xingxi](https://github.com/Yuuyuko-uu/dsh-xingxi)（星晞）

- 借鉴内容：**把整理好的记忆档案连成一张看得见的星图**——经历是节点、关系是连线、被想起越多越醒目，
  以及"记忆的形状本身值得被看一眼"这个产品判断。
- 落点：`tools/star-map.mjs`、`tests/star-map.test.mjs`（本轮新增；只读工具，不进读写路径）。
- 说明：该仓库是自定义许可（GitHub 标为 NOASSERTION，衍生作品要沿用同许可），所以**一行代码都没拿**：
  数据来自本仓库自己的 `loadAll` / `then.refs` / `link-events` / `recall-events`，
  聚类、摆位、渲染都是本项目自写；生成的 HTML 不带任何外链。

## AGPL-3.0（只学设计，不抄代码）

### [Lingximo/Lysmor](https://github.com/Lingximo/Lysmor)

- 借鉴内容：重要度衰减（被访问过衰减更慢、高重要度受保护）、钉住（pinned）、图扩展召回、
  **记忆星图**（把经历与联想摊成一张图看关系）、灾后复活（整包备份 + 换机恢复）的概念。
- 落点：衰减与钉住的原型（`开发/衰减-20261126/`，未合入本仓库）；记忆星图在 `tools/star-map.mjs`；其余在路线图。
- **未复制任何源代码**：AGPL-3.0 具传染性，抄代码会要求整个项目改用 AGPL；这里只采用了不受版权保护的设计思路。

## 关于"借鉴"的边界

- 只借鉴**思路与接口设计**，实现一律自写，并跑本项目的契约测试与评测闸门；
- 每个落点都在 `CHANGELOG` 里写明来源与许可证；
- 如果将来要直接复制 MIT 项目的代码片段，会在对应文件的头部注明来源与版权声明。