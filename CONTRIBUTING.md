# 参与这个项目

[中文](CONTRIBUTING.md) · [English](#english)

这个项目关心的是：一个角色能不能拥有自己的经历，并且回头看的时候，还能看见自己怎么变的。

欢迎的贡献：

- 缺陷报告，尤其是数据读不回来、跨会话看到不该看的东西
- 接入示例（别的宿主、别的语言、别的 agent 框架）
- 测试：召回是否准确、损坏文件是否保住、隐私边界是否守住
- 文档与翻译

不欢迎的提交：

- **真实的聊天记录、真人隐私、真实会话编号、本机绝对路径**
- API key、token、cookie
- 把 `then` 覆盖掉的"优化"
- 让人物"更像人"但删除历史的功能

## 开发环境

- Node.js 20 或更新（CI 同时跑 20 与 22）
- 没有第三方依赖，`git clone` 完就能跑

```sh
node packages/core/demo.mjs
node --test tests/
node tools/privacy-canary.mjs
```

## 改动前先想清楚的四件事

1. **旧的内容不能删**：`then` 是当时，`later` 是后来，只追加
2. **没有证据就说没有**：召回为空就是空，不要补一段"看起来合理"的
3. **隐私按会话隔离**：日记只在一对一；别人的私事不跨会话
4. **别替角色做决定**：什么时候记、记多细，是角色和宿主的事

## 提交 PR

- 一个 PR 只做一件事；说明里写清楚"改了什么、为什么、怎么验证的"
- 带测试；没有测试的修补丁，请说明手工验证步骤
- 涉及数据格式的改动，必须向后兼容，并在 PR 里写明迁移方式
- 提交信息用中文或英文都行，说清楚即可

## 版本与发布

遵循语义化版本：

- **patch**（0.1.x）：修缺陷、改文档、不改数据格式
- **minor**（0.x.0）：加字段、加命令、仍能读旧数据
- **major**（1.0.0 起）：需要迁移，或改变 `then` / `later` 的语义

仓库里有三个可发布包，各有自己的版本号和 tag 前缀：

| 包 | 目录 | 包名 | tag 前缀 |
| --- | --- | --- | --- |
| 核心 | `packages/core` | `whale-memory-core` | `core-v*` |
| 情绪采集 | `packages/emotion-intake` | `whale-emotion-intake` | `emotion-v*` |
| 作品稿本 | `packages/drafts` | `whale-drafts` | `drafts-v*` |

发版流程（以要发的那个包为准）：

1. 更新 `CHANGELOG.md` 的 `[Unreleased]`，改成新版本号与日期
2. 改对应包 `packages/<包>/package.json` 的 `version`
3. 语法/测试/闸门全过：`npm run check`（发布作业里也会再跑一次）
4. 打对应前缀的 tag：`git tag core-vX.Y.Z` / `emotion-vX.Y.Z` / `drafts-vX.Y.Z`，再 `git push origin <tag>`
5. tag 会触发 `.github/workflows/publish.yml` 里对应的作业，用 npm trusted publishing（OIDC）发布；失败不会消耗版本号，修完重推 tag 即可
6. 在 GitHub 建 release，正文取 CHANGELOG 对应段落

注意：`workflow_dispatch` 会同时尝试三个作业；只想发一个包时，用 tag，不要用手动触发。

破坏性改动必须在 PR 标题里写 `BREAKING`，并在 CHANGELOG 里单独一段。

## 跑不过怎么办

先看 `node --test tests/` 的具体失败项。数据相关的失败，**先备份 `WHALE_DATA_DIR` 再动手**——这个项目里，数据比代码重要。

---

## English

Short version:

- Contributions welcome: bug reports (especially lost records or cross-chat leaks), integration examples, tests, docs, translations.
- Do **not** submit real chat logs, personal data, real session ids, local absolute paths, API keys, or cookies.
- Node.js 20+ (CI runs 20 and 22); no dependencies. Run `node --test tests/` and `node tools/privacy-canary.mjs` before opening a PR.
- Design rules: `then` is immutable, `later` is append-only; never fabricate when evidence is missing; keep diary content to one-to-one conversations; let the character decide what to remember.
- One PR = one change, with tests and a short "what / why / how verified" note. Data-format changes must stay backward compatible and describe migration.
- When tests fail on data, back up `WHALE_DATA_DIR` first. In this project, data matters more than code.