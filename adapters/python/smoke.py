"""whale_memory 封装的自查（零第三方依赖）。

跑法::

    python adapters/python/smoke.py

它在一个**临时目录**里把封装的每条路径都走一遍：写 → 召回 → 改主意 → 封存 → 翻回那天 → 展示导出 → 体检，
外加两条反向检查（空正文要抛错；不发散的不存在 id 返回 ok:false 而不是抛错）。
不碰任何真实数据；临时目录是它自己 mkdtemp 出来的，跑完只删它自己建的那个。

退出码：0 通过 / 1 有检查失败 / 2 环境不具备（没有 node，或找不到 memory-cli.mjs）
"""

import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from whale_memory import WhaleMemory, WhaleMemoryError, available, default_cli_path  # noqa: E402

FAILED = []
CHECKS = []


def check(label, condition, detail=""):
    CHECKS.append(label)
    if condition:
        print("  PASS  " + label)
    else:
        FAILED.append(label + ("：" + detail if detail else ""))
        print("  FAIL  " + label + ("：" + detail if detail else ""))
    return bool(condition)


def main():
    if not available():
        print("环境不具备：找不到 node（WHALE_NODE / PATH）或 memory-cli.mjs（WHALE_CLI）。自查未执行。")
        print("  node：" + str(shutil.which("node")))
        print("  cli ：" + str(default_cli_path()))
        return 2

    root = Path(tempfile.mkdtemp(prefix="whale-py-smoke-"))
    print("临时数据根：" + str(root))
    try:
        mem = WhaleMemory(root)
        check("memory_dir 指向 <数据根>/plugin-data/biomimetic-memory",
              mem.memory_dir == root / "plugin-data" / "biomimetic-memory", str(mem.memory_dir))

        made = mem.write("自查：在西湖边坐到天黑", feeling=["平静"], weight="important")
        check("write 返回 id 与 day", bool(made.get("id")) and bool(made.get("day")), json.dumps(made, ensure_ascii=False))
        exp_id = made["id"]

        hits = mem.recall("西湖", limit=3)
        check("recall 命中刚写的那条", any(item.get("id") == exp_id for item in hits.get("items", [])),
              json.dumps(hits, ensure_ascii=False)[:200])

        revised = mem.revise(exp_id, "后来想起还是想笑")
        check("revise 返回 ok", revised.get("ok") is True, json.dumps(revised, ensure_ascii=False))

        missing = mem.revise("exp_根本没有这条", "白写")
        check("改不存在的 id 返回 ok:false（不抛错）", missing.get("ok") is False, json.dumps(missing, ensure_ascii=False))

        time.sleep(0.02)
        mid = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
        time.sleep(0.02)
        sealed = mem.seal(exp_id, note="自查用的封存理由")
        check("seal 返回 ok 且不是 noop", sealed.get("ok") is True and sealed.get("noop") is False,
              json.dumps(sealed, ensure_ascii=False))

        now_rows = mem.read(sealed=True, limit=10).get("items", [])
        now_one = next((r for r in now_rows if r.get("id") == exp_id), None)
        check("现在看：sealed 带理由", bool(now_one) and now_one.get("sealed", {}).get("note") == "自查用的封存理由",
              json.dumps(now_one, ensure_ascii=False)[:300])

        past_rows = mem.read(sealed=True, limit=10, as_of=mid).get("items", [])
        past_one = next((r for r in past_rows if r.get("id") == exp_id), None)
        check("翻回封存前：标 afterAsOf 且摘掉理由",
              bool(past_one) and past_one.get("sealed", {}).get("afterAsOf") is True and "note" not in past_one.get("sealed", {}),
              json.dumps(past_one, ensure_ascii=False)[:300])

        book = mem.book()
        check("book 拿到 markdown 且不写封存正文",
              isinstance(book.get("markdown"), str) and "自查：在西湖边坐到天黑" not in book.get("markdown", ""))

        # 参数错误：CLI 的顶层 catch 统一成 {ok:false,error}，封装原样返回（不吞、也不假装成功）
        bad_write = mem.write("")
        check("write 空正文返回 ok:false（不抛、不当成功）", bad_write.get("ok") is False and bool(bad_write.get("error")),
              json.dumps(bad_write, ensure_ascii=False)[:200])

        bad_limit = mem.recall("x", limit=-1)
        check("负数 limit 返回 ok:false", bad_limit.get("ok") is False, json.dumps(bad_limit, ensure_ascii=False)[:200])

        # 真·异常路径：CLI 文件不存在时，构造就抛 WhaleMemoryError
        try:
            WhaleMemory(root, cli=str(root / "根本没有这个文件.mjs"))
        except WhaleMemoryError:
            check("CLI 不存在时抛 WhaleMemoryError", True)
        else:
            check("CLI 不存在时抛 WhaleMemoryError", False, "没有抛错")

        doctor = mem.doctor()
        check("doctor 返回检查项", isinstance(doctor.get("checks"), list) and len(doctor["checks"]) > 0,
              json.dumps(doctor, ensure_ascii=False)[:200])
    finally:
        # 只删自己 mkdtemp 出来的这个目录
        if str(root).startswith(tempfile.gettempdir()):
            shutil.rmtree(root, ignore_errors=True)

    if FAILED:
        print("\n自查失败 %d 项：" % len(FAILED))
        for item in FAILED:
            print("  - " + item)
        return 1
    print("\n自查通过：Python 封装的 %d 项检查全部成立。" % len(CHECKS))
    return 0


if __name__ == "__main__":
    sys.exit(main())