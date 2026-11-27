import fs from 'node:fs'
import path from 'node:path'

// 0.28.x：npm 包里要带上 schema 与契约正文，否则装包的人看不到"数据长什么样"
const pkg = path.resolve(import.meta.dirname)                    // packages/core
const root = path.resolve(pkg, '..', '..')                      // repo root
fs.mkdirSync(path.join(pkg, 'schemas'), { recursive: true })
fs.copyFileSync(path.join(root, 'schemas', 'record.v1.json'), path.join(pkg, 'schemas', 'record.v1.json'))
fs.copyFileSync(path.join(root, 'docs', 'contract-v1-zh.md'), path.join(pkg, 'contract-v1-zh.md'))
console.log('prepack：schemas/record.v1.json 与 contract-v1-zh.md 已就位')