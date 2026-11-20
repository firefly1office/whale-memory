# Cross-window memory: when someone's words can be carried into another room

> Translated from the Chinese original ([中文](../cross-room-memory.md)). If they disagree, the Chinese version is authoritative.

A character lives at the same time in a group chat, the owner's private chat and a friend's private chat. How much she should remember is a product question; **whether she can carry words from window A into window B** is a question of safety and tact.

What is generic in this repository is the decision logic and the redaction, not any one host's implementation.

## 1. Visibility is not "all shared" or "all isolated"

The real requirement is usually:

| Source → target | Expected |
| --- | --- |
| Owner's private chat → group | **Deny** (private matters that have not been made public must not enter the group) |
| Local owner session → group | Deny |
| Owner's private chat → a friend's private chat | Up to the product (this project allows it by default) |
| A friend's private chat → group | Up to the product (allowed by default, but we suggest caution) |
| Group A → group B | Allow |
| The same room | Only recognised when it is the same persona slot |

`createAudience` turns these decisions into pure functions:

```js
import { createAudience } from 'whale-memory-core/conversation-privacy'

const aud = createAudience({ ownerId: '10001' })
aud.permits('private_10001', 'group_40101')   // false: the owner's private chat does not flow into the group
aud.permits('private_10001', 'private_20002') // true: into a friend's private chat it can carry over
aud.permits('group_40101', 'group_40102')     // true
aud.permits('group_1#p_aa', 'group_1#p_bb')   // false: a different persona does not cross over
```

**The defaults are not hidden in the implementation**: `isActive` is left to the host (whether a persona slot is valid, whether it has been forgotten, and so on), and this project supplies only the hard boundary "the owner's private chat does not flow into a group" plus the same-room rule.

## 2. Redaction has to happen before the prompt

The model can decide whether to bring something up, but what it looks like when retold should not be left to the model:

```js
import { redactSensitive } from 'whale-memory-core/conversation-privacy'

redactSensitive('验证码 938475')        // '（密钥略）'
redactSensitive('https://a.example.com/x') // '（链接略）'
redactSensitive('昨天吃了黄焖鸡')          // returned unchanged
```

Numbers (6 digits or more), links, email addresses, key strings and strings longer than 24 characters are scrubbed before the content enters the prompt.
What the model sees is "(number redacted)" — it cannot let slip something it never saw.

## 3. Facts and events are stored separately

She remembers "what we talked about that day" (an event), but may not remember "what he likes to eat" (a fact). The two update at different rhythms:
events are only appended, facts get overwritten. So facts get a JSONL of their own:

```js
import { saveFacts, relevantFacts, renderFactsLine } from 'whale-memory-core/fact-store'

saveFacts(dir, [{ kind: 'like', value: '黄焖鸡' }])
const top = relevantFacts(loadFacts(dir), '晚上吃黄焖鸡吗', { limit: 2 })
renderFactsLine(top)   // '（你还记得：你喜欢黄焖鸡。）'
```

`relevantFacts` only picks the few relevant ones when asked; if nothing is relevant it returns nothing — **better to say nothing than to say something wrong**.

Where do facts come from? Two paths:

- `fact-card`: a rule-based fallback that catches "the project is called X / I live in Y / I do not eat Z". Fast and free, but it cannot catch implicit phrasing.
- `fact-judge`: hands a batch of messages to the model and requires a quotation that can be found in the original text; anything that does not match is discarded.

## 4. The cost of this path

Cross-window sharing solves "change the conversation and it is like amnesia"; the cost is that **other people's privacy may be exposed by accident**.
This repository provides only the decision logic and the redaction; the rest of the trade-off has to be written down by each host: which windows are open, which are permanently isolated, and what may only be retold vaguely even when it is open.

If you are unsure, treat it as private.

### What redaction covers, and what it misses

| Content | Handling |
|---|---|
| Six or more digits, phone numbers | （数字略）(*digits omitted*) |
| URLs, email addresses | （链接略）/（邮箱略） |
| Passwords, verification codes, tokens | （密钥略） |
| Street addresses (3 号楼 502 室, 中山路 88 号) | （门牌略） |
| Short numbers without a keyword ("1234") | **not redacted** |
| Amounts, years, page numbers (3000 块, 2026 年, page 88) | **not redacted** |

Short numbers are a deliberate trade-off: better to let a stray "1234" through than to eat every amount, date and page number. Addresses only get redacted because they are anchored by a unit word (号 / 弄 / 栋 / 室), so the blast radius is small.

One rule that is not redaction but matters just as much: **when recall comes back empty, the host must not let the model complete the user's false premise**. If someone states something that never happened ("that beach we went to last time"), an empty result is not agreement. The MCP adapter carries this in the `initialize` instructions.

