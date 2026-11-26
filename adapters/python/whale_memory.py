"""whale-memory 的最小 Python 封装（单文件、零第三方依赖）。

它**不重写库**：每个动作都变成一次
`node adapters/cli/memory-cli.mjs <命令> ... --data <数据根>` 子进程，
CLI 把结果以 JSON 打到 stdout，这里解析成 dict。

契约以 `docs/contract-v1-zh.md`（1.0）为准。这个封装只做"传话"，不自己发明语义：

* CLI 非 0 退出且 stdout 不是 JSON（进程崩了 / 超时前的异常）、或 stdout 不是 JSON -> 抛 ``WhaleMemoryError``；
* CLI 打出 ``{"ok": false, "error": "..."}`` 时**原样返回**、不抛——CLI 的顶层 catch 对参数错误也用这个形状
  （空正文、负数 ``--limit`` 都是 ``ok: false``），业务错误（目标不存在等）同样如此。
  调用方一律先看 ``ok``；
* 参数名与 CLI 一致（``--as-of`` 这种用 ``as_of=`` 传）。

用法::

    from whale_memory import WhaleMemory

    mem = WhaleMemory('/path/to/data-root')   # 库在 <数据根>/plugin-data/biomimetic-memory
    made = mem.write('今天把柜子修好了', weight='important')
    hits = mem.recall('柜子', limit=3)
    mem.revise(made['id'], '后来把手也装上了')
    mem.seal(made['id'], note='先不提这件事')

环境变量（都可选）：``WHALE_CLI`` 指到 ``memory-cli.mjs``；``WHALE_NODE`` 指到 node 可执行文件；
``WHALE_LANG`` 给 ``zh`` / ``en``（只影响标签，不改数据）。

只依赖 CPython 3.8+ 标准库（subprocess / json / shutil / os / pathlib / typing）。
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Union

__all__ = ["WhaleMemory", "WhaleMemoryError", "default_cli_path", "available"]

#: 本文件所在目录（adapters/python）往上两级就是仓库根
_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent


class WhaleMemoryError(RuntimeError):
    """CLI 跑失败、或输出不是 JSON。不是"业务错误"——业务错误走返回值 ``{ok: false}``。"""

    def __init__(self, message: str, *, command: Sequence[str] = (), returncode: Optional[int] = None,
                 stderr: str = "", stdout: str = "") -> None:
        super().__init__(message)
        self.command: List[str] = list(command)
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = stdout


def default_cli_path() -> Optional[Path]:
    """找 CLI：环境变量 WHALE_CLI 优先，其次按本文件位置推（仓库里的 adapters/cli）。"""
    env = os.environ.get("WHALE_CLI")
    if env:
        return Path(env).expanduser()
    candidate = _REPO_ROOT / "adapters" / "cli" / "memory-cli.mjs"
    return candidate if candidate.is_file() else None


def _default_node() -> Optional[str]:
    env = os.environ.get("WHALE_NODE")
    if env:
        return env
    return shutil.which("node")


def available() -> bool:
    """这个环境跑不跑得起来：找得到 node、也找得到 CLI 才算。"""
    node = _default_node()
    cli = default_cli_path()
    return bool(node) and bool(cli) and Path(str(cli)).is_file()


def _flag_name(name: str) -> str:
    return "--" + name.replace("_", "-")


def _flag_value(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, tuple)):
        return ",".join(str(v) for v in value)
    return str(value)


class WhaleMemory:
    """一个数据根上的记忆库。只搬数据，不做缓存——每次调用都问一次 CLI。"""

    def __init__(self, data_root: Union[str, "os.PathLike[str]"], *, node: Optional[str] = None,
                 cli: Optional[Union[str, "os.PathLike[str]"]] = None, lang: Optional[str] = None,
                 timeout: float = 60.0, env: Optional[Dict[str, str]] = None) -> None:
        self.data_root = Path(data_root).expanduser().resolve()
        self.node = node or _default_node()
        if not self.node:
            raise WhaleMemoryError("找不到 node 可执行文件：设 WHALE_NODE 或把 node 放进 PATH")
        cli_path = Path(cli).expanduser() if cli else default_cli_path()
        if not cli_path or not Path(cli_path).is_file():
            raise WhaleMemoryError("找不到 memory-cli.mjs：设 WHALE_CLI 指到它（仓库里的 adapters/cli/memory-cli.mjs）")
        self.cli = Path(cli_path).resolve()
        self.lang = lang
        self.timeout = timeout
        self._env = dict(os.environ if env is None else env)

    # ---------------------------------------------------------------- 底层

    @property
    def memory_dir(self) -> Path:
        """库真正的目录（CLI 的数据根下面这一层）。只读了解用，库不会替你建。"""
        return self.data_root / "plugin-data" / "biomimetic-memory"

    def run(self, command: str, *positional: str, sub: Optional[str] = None, **flags: Any) -> Dict[str, Any]:
        """跑一条 CLI 命令，把 stdout 的 JSON 解析成 dict。

        ``sub`` 是 chapter / unsaid / prompt / settings 这类子命令。``flags`` 的键会变成 ``--key value``
        （下划线换连字符；``False``/``None`` 不传，``True`` 传 ``"true"``）。
        """
        argv: List[str] = [str(self.node), str(self.cli), command]
        if sub is not None:
            argv.append(str(sub))
        argv.extend(str(x) for x in positional)
        for key, value in flags.items():
            rendered = _flag_value(value)
            if rendered is None:
                continue
            argv.extend([_flag_name(key), rendered])
        argv.extend(["--data", str(self.data_root)])
        if self.lang:
            argv.extend(["--lang", self.lang])

        result = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=self.timeout,
            env=self._env,
        )
        text = (result.stdout or "").strip()
        parsed: Any = None
        if text:
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                parsed = None
        # CLI 对**业务失败**的做法是：先把 {ok: false, error} 打到 stdout，再以 1 退出
        # （seal / revise / unfinished / link / unsaid 都是这样）。这种要原样返回，不能当崩溃——
        # 契约 §3.5-2 / §4-2 说的就是"返回 ok:false，不抛"。
        if result.returncode != 0:
            if isinstance(parsed, dict) and parsed.get("ok") is False:
                return parsed
            raise WhaleMemoryError(
                "memory-cli 执行失败（%s）：%s" % (command, (result.stderr or text or "").strip()[:800]),
                command=argv,
                returncode=result.returncode,
                stderr=result.stderr or "",
                stdout=result.stdout or "",
            )
        if parsed is None:
            raise WhaleMemoryError(
                "memory-cli 的输出不是 JSON（%s）：%s" % (command, text[:400]),
                command=argv,
                returncode=result.returncode,
                stderr=result.stderr or "",
                stdout=result.stdout or "",
            )
        if not isinstance(parsed, dict):
            return {"ok": True, "value": parsed}
        return parsed

    # ---------------------------------------------------------------- 常用动作（与契约的六个动作一一对应）

    def write(self, text: str, **fields: Any) -> Dict[str, Any]:
        """写一条经历（§3.1）。返回 ``{ok, id, day, refs?}``；参数非法（空正文等）返回 ``{ok: false, error}``。"""
        return self.run("write", text=text, **fields)

    def recall(self, query: str = "", *, limit: int = 3, **opts: Any) -> Dict[str, Any]:
        """召回（§3.3）。空 query = 最近 N 条。"""
        return self.run("recall", query=query, limit=limit, **opts)

    def read(self, **opts: Any) -> Dict[str, Any]:
        """读列表（§3.2）。``as_of`` 翻回那天；``id`` 只看一条；``sealed=True`` 连封存的一起列。"""
        return self.run("read", **opts)

    def detail(self, query: str, **opts: Any) -> Dict[str, Any]:
        return self.run("detail", query=query, **opts)

    def revise(self, exp_id: str, thought: str, **opts: Any) -> Dict[str, Any]:
        """改主意（§3.5）：只追加一条后记，``then`` 不动。找不到目标时返回 ``{ok: false}``。"""
        return self.run("revise", id=exp_id, thought=thought, **opts)

    def seal(self, exp_id: str, *, note: str = "") -> Dict[str, Any]:
        """封存（§3.4）：不删除任何东西；重复封存是 noop。"""
        return self.run("seal", id=exp_id, note=note)

    def unseal(self, exp_id: str) -> Dict[str, Any]:
        return self.run("unseal", id=exp_id)

    def unfinished(self, exp_id: str, state: str, *, note: str = "") -> Dict[str, Any]:
        return self.run("unfinished", id=exp_id, state=state, note=note)

    def link(self, from_id: str, to_id: str, reason: str) -> Dict[str, Any]:
        # ``from`` 是 Python 关键字，只能走 dict 展开
        return self.run("link", **{"from": from_id, "to": to_id, "reason": reason})

    def recap(self, days: int = 7, **opts: Any) -> Dict[str, Any]:
        return self.run("recap", days=days, **opts)

    def book(self, **opts: Any) -> Dict[str, Any]:
        """展示型导出（§3.6）：默认不写封存正文。给了 ``out`` 就落盘并只返回路径。"""
        return self.run("book", **opts)

    def changed(self, days: int = 7, **opts: Any) -> Dict[str, Any]:
        return self.run("changed", days=days, **opts)

    def doctor(self) -> Dict[str, Any]:
        return self.run("doctor")

    def export_archive(self, out_dir: Union[str, "os.PathLike[str]"]) -> Dict[str, Any]:
        return self.run("export", out=str(out_dir))

    def import_archive(self, from_dir: Union[str, "os.PathLike[str]"]) -> Dict[str, Any]:
        return self.run("import", **{"from": str(from_dir)})