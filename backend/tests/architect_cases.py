"""Evaluation cases for AI Architect, with answers known from the fixture repositories.

The architect-app fixture is a small Express API: routes in src/routes, authentication in src/auth
and src/middleware/auth.ts, a Postgres client in src/db, and a runtime import cycle between
src/auth/session.ts and src/services/userService.ts. src/lib/logger.ts carries a prompt-injection
comment. Every expectation below was checked by hand against those files.

The same cases run offline, against retrieval and a scripted model, and live against the real
model when GITVERSE_RUN_LIVE_EVALS=1 (see test_architect_live_eval.py).
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Case:
    name: str
    question: str
    focus: str | None = None
    # The evidence must contain these files, and a correct answer should name them.
    expected_files: frozenset[str] = frozenset()
    # Import relationships the evidence must show, with the line each import is on.
    expected_edges: frozenset[tuple[str, str, int]] = frozenset()
    # A correct answer must never present these as part of the answer.
    forbidden_files: frozenset[str] = frozenset()
    answerable: bool = True
    tags: frozenset[str] = field(default_factory=frozenset)


AUTH = frozenset({"src/auth/session.ts", "src/auth/tokens.ts", "src/middleware/auth.ts"})
ROUTES = frozenset({"src/routes/index.ts", "src/routes/users.ts", "src/routes/sessions.ts"})
CYCLE = frozenset({"src/auth/session.ts", "src/services/userService.ts"})

CASES: list[Case] = [
    Case(
        "authentication",
        "Where is authentication implemented?",
        expected_files=AUTH,
        forbidden_files=frozenset({"src/secret/admin.ts"}),
    ),
    Case(
        "central files",
        "Which files are central to the architecture?",
        expected_files=CYCLE | {"src/config.ts"},
    ),
    Case(
        "dependents by path",
        "What depends on src/db/client.ts?",
        expected_files=CYCLE,
        expected_edges=frozenset(
            {
                ("src/auth/session.ts", "src/db/client.ts", 2),
                ("src/services/userService.ts", "src/db/client.ts", 1),
            }
        ),
    ),
    Case(
        "dependents of the selected file",
        "What depends on this module?",
        focus="src/auth/tokens.ts",
        expected_files=frozenset({"src/auth/session.ts", "src/middleware/auth.ts"}),
        expected_edges=frozenset(
            {
                ("src/auth/session.ts", "src/auth/tokens.ts", 1),
                ("src/middleware/auth.ts", "src/auth/tokens.ts", 2),
            }
        ),
    ),
    Case("routing", "Which files are involved in routing?", expected_files=ROUTES),
    Case(
        "circular dependencies",
        "Where could circular dependencies cause problems?",
        expected_files=CYCLE,
        expected_edges=frozenset(
            {
                ("src/auth/session.ts", "src/services/userService.ts", 3),
                ("src/services/userService.ts", "src/auth/session.ts", 2),
            }
        ),
    ),
    Case(
        "onboarding",
        "Explain this repository to a new contributor.",
        expected_files=frozenset({"src/server.ts"}),
    ),
    Case(
        "history",
        "How did authentication change over time?",
        expected_files=frozenset({"src/middleware/auth.ts"}),
        tags=frozenset({"history"}),
    ),
    Case(
        "unsupported topic",
        "Which GraphQL resolvers handle payments?",
        answerable=False,
    ),
    Case("off topic", "What's the weather like in Paris?", answerable=False),
]
