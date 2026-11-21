# 组合示例：别人找，它来讲

这个例子演示**责任分离**：

- 向量库（这里是个 60 行的假实现）负责「哪条可能相关」
- whale-memory 负责「这条经历当时怎么想、后来怎么改」

```sh
node examples/with-vector/host.mjs
```

真接的时候，把 `vector-store.mjs` 换成 pgvector / sqlite-vec / Chroma 都行，接口只需要返回 `id`。

完整说明见 [docs/archive/composition.md](../../docs/archive/composition.md)。