# 文字情感实验模块

先理解一句话在这段交流里意味着什么，再分别提出自己的感受和关系事件。第一版放在 `packages/emotion/`，是仓库内可调用的实验模块，尚未发布到 npm，也没有接到鲸鲸或改变现有记忆内核。

## 运行

仓库根目录，Node.js 20+，无第三方依赖：

```sh
node --test tests/text-emotion.test.mjs
node examples/text-emotion/demo.mjs
node examples/text-emotion/evaluate.mjs
```

前两项验证工程机制，demo 使用预设回答。第三项默认只列出 18 份虚构开发题，输出 `semanticAccuracy: null`，不会调用模型。题目覆盖同样的哭在录取/失去/未知情境，同样的玩笑在被接受/已有边界情境，以及表白、引用、纠错、转述、复杂感受。

## 宿主接口

```js
import { evaluateEmotion, projectEmotion } from './packages/emotion/index.js'

const scope = { characterId: 'my-character', scope: 'private-conversation', personId: 'friend' }
const result = await evaluateEmotion({
  enabled: true,
  dir: './emotion-data', // 独立目录，不使用记忆库的 JSONL 文件
  input: {
    ...scope,
    turn: { id: 'message-1', at: Date.now(), text: '我高兴得想哭。' },
    history: [],
    memories: []
  },
  generate: async (messages, { signal }) => {
    // 接到宿主已有模型调用，返回解析好的 JSON，支持 AbortSignal。
    return yourModel.generateJson(messages, { signal })
  }
})
const state = projectEmotion('./emotion-data', scope)
```

`generate` 是真正理解文字的模型入口，本模块没有用新词表冒充语义理解。结构见 `context.js` 中的 `FORMAT`。`interpretations` 最多三个，`selected: null` 可保留不确定；`selfFeelings` 可以为空或有相反方向的多项；`relationship` 独立提出具体事件。

`history` 每项为 `{characterId, scope, personId, id, role, at, text}`，role 只接受 user/assistant。`memories` 每项为 `{characterId, scope, personId, id, kind, at, text, visible:true}`，kind 是 concern/relationship/boundary/experience。三个范围字段必须与本轮一致。宿主应先核实可见性，再传入选中的记录；最多取当前时点前最近 12 条历史、8 条记忆，正文总预算 16000 字符。超预算报错，不截断后把残句当原文。

可以把 whale-memory `selfExperience.currentView` 读出的、当前仍可见的经历或后记作为材料。`at` 必须使用这段材料实际写下的时间（后记不能冒用原经历的日期），`id` 应能追溯具体版本。`concern` 必须是角色已经表达过的关切，不能仅因为模型想生成感受就编一个愿望。封存、授权和材料失效检查由宿主负责；本接口不自动读取任何真实聊天或记忆目录。

## 结算语义

- 解释、感受和关系事件共用一次模型判断，不另跑关键词扣分。
- 每项解释须引用本轮原文；自己的感受还须引用已有 concern/relationship/boundary 材料。没有材料可以不生成感受，仍可正常回复。引用存在只验证出处，**不能证明模型的解释正确**。
- 默认只有明确选中 high 解释、有明确对象及相符事件类型时才允许关系变化。边界有独立规则：明确选中 boundary/hurt、certainty=medium、target=person，并引用本轮行为和已有 boundary 时，允许 boundary_violation 结算。依据是可观察行为与已知边界的冲突，不要求推断故意伤害。low、未选定、mixed/playful、对象不明或第三方均不适用此例外。引用存在仍不证明语义关系正确，等级也不是校准后的概率。
- 新事件记录 `settlementPolicy: boundary-v2`；没有此字段的历史日志继续按 legacy-high 回放，升级不追溯改变旧关系。离线政策重算明确另列，不冒充当时发生的结算。
- 直接调用 `settle(appraisal)` 或 `admits(appraisal)` 默认使用 `legacy-high`，保持旧调用行为。要使用边界例外，显式传入 `{policy:'boundary-v2', sources}`；参数应先经过 `validateAppraisal`。`evaluateEmotion` 内部显式选择 boundary-v2，新事件与澄清通过同一 `admits` 判断。
- 难过、愉悦与关系增减独立。普通对话不自动加分，心情差不扣信任，离线时间不扣好感。关系系数是保守的工程初值，不是生物学结论或已验证参数，见 `appraisal.js`。
- 感受保留各自原因，以两小时半衰期回落；没有随机心情。`mood` 是有效感受的加权摘要，基线为零。半衰期可配置，关系基线可配置，默认信任 0.5、亲近 0.5、张力 0。投影时应始终使用同一套基线与参数，不能把上次投影作为新基线。
- 不自动创建自传，不修改 `then`/`later`。这里记录的是模型提出的判断，不等同于角色亲笔自述或已核实的人类心理事实。

## 修正误会与隔天恢复

上线前待处理：high 是模型自评，未经校准，不能等同于可靠的撤销授权。目前 high 澄清可以撤销已有伤害的当前结算，即使只是“我开玩笑的”；旧事件和按时点投影仍保留，历史未被删除。接入鲸鲸前，应单独确定宿主确认或显式撤销标记等措施及其验收口径。这些措施尚未实现，本次实验交付不改变该行为。

澄清的 medium 边界例外只用于补记或确认伤害：按旧事件自己的政策计算原关系增量，再比较新提案，要求信任/亲近增量不增加、张力增量不减少。撤销或减轻任一维度的既有伤害仍须 high；普通玩笑解释、未选定解释等仍返回 unresolved。替换后从基线回放，不额外扣第二次。

传入新的澄清消息，并指定 `supersedes: result.eventId`。修正必须属于同一角色、会话和人物，并指向当前有效版本。新事件追加到 `emotion-events.jsonl`，旧事件保持原样。当前关系按修正版替换旧事件后从基线重算，而非增加补偿好感；后续事件仍保留。`projectEmotion(..., {now: oldTimestamp})` 可查看当时尚未修正的状态。对新解释仍拿不准时返回 `unresolved`，保留原事件，不因一句“开玩笑”强行撤销已有伤害。

同一消息 id 重复调用不重复结算；同 id 内容不同会报错。模型调用过程中同一范围发生了新写入则返回 `stale`，宿主需要读取最新上下文后再决定是否重试。未完成、取消、无效引用和提供方失败不追加记录。文件损坏直接报错，不跳过损坏的修正记录。并发追加复用 core 的文件锁；因此目前是仓库内模块，不应单独复制此文件夹作为独立 npm 包。

日志包含传入的有限上下文和解释，是明文且可能包含私人信息。本模块不提供访问控制，scope 元数据由受信宿主提供，不是认证。日志备份、保留、删除由宿主负责，不在记忆核心现有备份七文件的范围内。投影目前整文件读取，未做大规模性能验收。不同聊天的状态完全隔离，尚无跨会话合并关系功能。

## 模型评测

拦截统计分为 `blockedWrong`（提案不符冻结预期，被挡回）和 `blockedCorrect`（提案符合冻结预期，却被挡回）。`blockedProposals` 是二者之和。这里的“正确”只针对 rubric，不代表已核实人类心理；未通过结构校验的输出仍单列失败，不纳入有效拦截计数。

接入一个导出 `generate(messages, {signal})` 的 ESM 文件，返回解析好的 JSON。模板在 `examples/text-emotion/provider.example.mjs`，使用显式配置的 `EMOTION_API_URL`、`EMOTION_MODEL`、`EMOTION_API_KEY`。密钥只在环境中配置，不写进仓库。

```sh
node examples/text-emotion/evaluate.mjs --provider ./examples/text-emotion/provider.example.mjs --out emotion-report.json
```

会向所选提供方发送 **36 次请求**（18 题 × 普通结构化提示/语境引导两组），可能产生费用。只发送虚构输入，预期标签和人工判读口径不会传给模型。逐题保留原始结构化输出、错误、请求哈希与应用结果，不择优重试。无效输出、跳过与失败保留在分母。两组请求交替排序；每题每组一次，不能估计随机波动。

新版报告把 `checks.proposed`（模型提案与预期一致）和 `checks.applied`（实际结算与预期一致）分开。汇总分别提供 proposedMatches、appliedMatches、blockedProposals；proposalChecksPassed 只组合分类、提案和弃权，不计门槛拦截的功劳。所有请求留在分母，校验失败单列；无有效判断时不算通过。旧报告的 structuredChecksPassed 保留为历史口径，不能直接作为新版基线。`manualReview` 和 `semanticAccuracy` 继续留空，开发题的标注缺陷也未通过事后改分掩盖。

开发题已经参与设计，不能作为独立留出集。已使用用户配置的 DeepSeek 完成三轮开发试跑，共 108 次请求；[逐项观察与全部原始结果](../../examples/text-emotion/results.md)保留失败与局限。尚无独立盲评或线上误判率，不能把粗检查得分当成理解准确率。扩大使用前应新增未参与调试的同句异境题，并与同模型基础提示对照。

`responseHint` 已从当前提示协议、标准化返回和新事件写入中删除。提供方即使附带旧字段也会被丢弃；旧日志进入澄清上下文时同样清除。历史采样报告保留原始字段供审计，不能作为回复接口。实际回复层尚未实现或评测。
