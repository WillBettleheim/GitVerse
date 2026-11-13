"""A real git repository with known history, built with the git CLI for tests.

c1  src/a.ts → src/b.ts, and src/util.ts
c2  adds src/c.ts (→ a.ts); b.ts now imports util.ts
c3  moves util.ts to helpers.ts unchanged; b.ts imports helpers.ts; removes c.ts
c4  renames a.ts to core.ts and edits it in the same commit
"""

import io
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from app.analysis.archive import read_snapshot
from app.analysis.pipeline import analyze_snapshot
from app.core.config import AnalysisLimits
from app.schemas.graph import CodeGraph, RepositoryInfo

GIT = shutil.which("git")
LIMITS = AnalysisLimits(_env_file=None)  # type: ignore[call-arg]


@dataclass(frozen=True)
class FixtureCommit:
    sha: str
    date: str
    message: str


class GitFixture:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.commits: list[FixtureCommit] = []
        self._git("init", "-q", "-b", "main")

    def _git(self, *args: str, date: str | None = None) -> str:
        env = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": str(self.root),
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "Fixture Author",
            "GIT_AUTHOR_EMAIL": "author@example.com",
            "GIT_COMMITTER_NAME": "Fixture Author",
            "GIT_COMMITTER_EMAIL": "author@example.com",
        }
        if date:
            env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = date
        # Hooks and signing disabled, so the user's own git setup can't interfere.
        command = [GIT or "git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false"]
        return subprocess.run(  # noqa: S603
            [*command, *args], cwd=self.root, env=env, check=True, capture_output=True, text=True
        ).stdout.strip()

    def write(self, path: str, content: str) -> None:
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def commit(self, message: str, date: str) -> FixtureCommit:
        self._git("add", "-A")
        self._git("commit", "-q", "-m", message, date=date)
        commit = FixtureCommit(self._git("rev-parse", "HEAD"), date, message)
        self.commits.append(commit)
        return commit

    def move(self, old: str, new: str) -> None:
        self._git("mv", old, new)

    def remove(self, path: str) -> None:
        self._git("rm", "-q", path)

    def blob(self, sha: str, path: str) -> str:
        return self._git("rev-parse", f"{sha}:{path}")

    def tarball(self, sha: str) -> io.BytesIO:
        """What codeload.github.com returns: a tar.gz with one top-level folder."""
        data = subprocess.run(  # noqa: S603
            [GIT or "git", "archive", "--format=tar.gz", f"--prefix=acme-repo-{sha[:7]}/", sha],
            cwd=self.root,
            check=True,
            capture_output=True,
        ).stdout
        return io.BytesIO(data)

    def analyze(self, commit: FixtureCommit) -> CodeGraph:
        repository = RepositoryInfo(
            owner="acme",
            name="repo",
            full_name="acme/repo",
            url="https://github.com/acme/repo",
            default_branch="main",
            commit_sha=commit.sha,
            committed_at=commit.date,
            commit_message=commit.message,
            commit_author="Fixture Author",
            stars=0,
            forks=0,
            archived=False,
        )
        return analyze_snapshot(repository, read_snapshot(self.tarball(commit.sha), LIMITS))


def build_history(root: Path) -> GitFixture:
    repo = GitFixture(root)
    repo.write("src/a.ts", 'import { b } from "./b";\nexport const a = () => b();\n')
    repo.write("src/b.ts", "export const b = () => 1;\n")
    repo.write("src/util.ts", "export const util = (x: number) => x * 2;\n")
    repo.commit("Initial structure", "2024-01-01T10:00:00Z")

    repo.write("src/c.ts", 'import { a } from "./a";\nexport const c = a;\n')
    repo.write("src/b.ts", 'import { util } from "./util";\nexport const b = () => util(1);\n')
    repo.commit("Add c and use util in b", "2024-02-01T10:00:00Z")

    repo.move("src/util.ts", "src/helpers.ts")
    repo.write("src/b.ts", 'import { util } from "./helpers";\nexport const b = () => util(1);\n')
    repo.remove("src/c.ts")
    repo.commit("Move util to helpers and drop c", "2024-03-01T10:00:00Z")

    repo.move("src/a.ts", "src/core.ts")
    repo.write(
        "src/core.ts",
        'import { b } from "./b";\nexport const core = () => (b() > 0 ? b() : 0);\n',
    )
    repo.commit("Rename a to core and change it", "2024-04-01T10:00:00Z")
    return repo
