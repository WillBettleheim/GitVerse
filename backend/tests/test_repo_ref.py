import pytest

from app.services.repo_ref import InvalidRepoRef, parse_repo_ref


@pytest.mark.parametrize(
    "raw",
    [
        "vercel/next.js",
        "  vercel/next.js  ",
        "https://github.com/vercel/next.js",
        "https://github.com/vercel/next.js/",
        "https://github.com/vercel/next.js.git",
        "https://www.github.com/vercel/next.js",
    ],
)
def test_accepts_and_canonicalises(raw: str) -> None:
    ref = parse_repo_ref(raw)
    assert ref.full_name == "vercel/next.js"
    assert ref.clone_url == "https://github.com/vercel/next.js.git"


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "justoneword",
        "a/b/c",
        "https://github.com/vercel/next.js/tree/canary",
        # Other hosts and look-alikes
        "https://gitlab.com/vercel/next.js",
        "https://github.com.evil.example/vercel/next.js",
        "https://evil.example/github.com/vercel/next.js",
        # Credentials, ports, query strings
        "https://token@github.com/vercel/next.js",
        "https://user:pass@github.com/vercel/next.js",
        "https://github.com@evil.example/vercel/next.js",
        "https://github.com:8443/vercel/next.js",
        "https://github.com:notaport/vercel/next.js",
        "https://github.com/vercel/next.js?x=1",
        "https://github.com/vercel/next.js#readme",
        # Schemes other than https
        "http://github.com/vercel/next.js",
        "ssh://git@github.com/vercel/next.js",
        "file:///etc/passwd",
        "git@github.com:vercel/next.js.git",
        # Path traversal and option injection against git
        "../etc",
        "vercel/..",
        "vercel/.",
        "vercel/.git",
        "vercel/-oProxyCommand=x",
        "--upload-pack=x/repo",
        "-owner/repo",
        "owner-/repo",
        "own--er/repo",
        # Shell metacharacters, whitespace, control characters
        "vercel/next.js;rm",
        "vercel/next$(id)",
        "vercel/next js",
        "vercel/next\njs",
        "vercel\\next.js",
        # Length limits
        f"{'a' * 40}/repo",
        f"owner/{'a' * 101}",
        "x" * 301,
    ],
)
def test_rejects(raw: str) -> None:
    with pytest.raises(InvalidRepoRef):
        parse_repo_ref(raw)
