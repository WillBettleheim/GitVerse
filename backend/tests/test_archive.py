import tarfile
import time

import pytest

from app.analysis.archive import read_snapshot
from app.analysis.errors import AnalysisError
from app.core.config import AnalysisLimits
from tests.archives import PREFIX, tarball_from_directory, tarball_from_entries


def limits(**overrides: int) -> AnalysisLimits:
    return AnalysisLimits(_env_file=None, **overrides)  # type: ignore[call-arg]


def member(name: str, kind: bytes, target: str = "", size: int = 0) -> tarfile.TarInfo:
    info = tarfile.TarInfo(name)
    info.type = kind
    info.linkname = target
    info.size = size
    return info


def test_reads_sources_and_skips_vendored_generated_and_minified() -> None:
    snapshot = read_snapshot(tarball_from_directory("web-app"), limits())
    assert sorted(snapshot.files) == [
        "scripts/run.mjs",
        "src/app.tsx",
        "src/broken.ts",
        "src/component.jsx",
        "src/decl-user.ts",
        "src/esm.ts",
        "src/index.ts",
        "src/lazy.ts",
        "src/legacy.js",
        "src/types.ts",
        "src/utils/helper.ts",
        "src/utils/index.ts",
    ]
    assert dict(snapshot.skipped) == {
        "vendored_or_generated": 2,
        "declaration_file": 1,
        "minified": 1,
    }
    assert "tsconfig.json" in snapshot.configs
    assert "src/styles.css" in snapshot.all_paths
    assert {"src/vendor.min.js", "src/global.d.ts"} <= snapshot.skipped_paths


def test_never_follows_symlinks_or_hard_links() -> None:
    archive = tarball_from_entries(
        [
            member(f"{PREFIX}/src/link.ts", tarfile.SYMTYPE, "/etc/passwd"),
            member(f"{PREFIX}/src/hard.ts", tarfile.LNKTYPE, f"{PREFIX}/src/real.ts"),
            (f"{PREFIX}/src/real.ts", b"export const real = 1;\n"),
        ]
    )
    snapshot = read_snapshot(archive, limits())
    assert list(snapshot.files) == ["src/real.ts"]
    assert snapshot.all_paths == {"src/real.ts"}


@pytest.mark.parametrize(
    "name",
    [f"{PREFIX}/../escape.ts", f"{PREFIX}/src/../../escape.ts", "/etc/evil.ts", f"{PREFIX}\\x.ts"],
)
def test_rejects_paths_that_escape_the_repository(name: str) -> None:
    with pytest.raises(AnalysisError) as error:
        read_snapshot(tarball_from_entries([(name, b"x")]), limits())
    assert error.value.code == "unsafe_archive"


def test_skips_devices_and_fifos() -> None:
    archive = tarball_from_entries(
        [member(f"{PREFIX}/dev.ts", tarfile.CHRTYPE), member(f"{PREFIX}/fifo.ts", tarfile.FIFOTYPE)]
    )
    assert read_snapshot(archive, limits()).files == {}


def test_skips_oversized_files_without_reading_them() -> None:
    archive = tarball_from_entries(
        [(f"{PREFIX}/big.ts", b"x" * 3000), (f"{PREFIX}/small.ts", b"export {};\n")]
    )
    snapshot = read_snapshot(archive, limits(max_file_size_kb=2))
    assert list(snapshot.files) == ["small.ts"]
    assert snapshot.skipped["too_large"] == 1


def test_detects_minified_code_without_a_min_extension() -> None:
    archive = tarball_from_entries([(f"{PREFIX}/bundle.js", b"var a=1;" * 400)])
    snapshot = read_snapshot(archive, limits())
    assert snapshot.files == {}
    assert snapshot.skipped["minified"] == 1


def test_fails_past_the_source_file_limit_rather_than_truncating() -> None:
    entries: list[tarfile.TarInfo | tuple[str, bytes]] = [
        (f"{PREFIX}/f{i}.ts", b"export {};\n") for i in range(4)
    ]
    with pytest.raises(AnalysisError) as error:
        read_snapshot(tarball_from_entries(entries), limits(max_source_files=3))
    assert error.value.code == "too_many_files"


def test_fails_past_the_archive_entry_limit() -> None:
    entries: list[tarfile.TarInfo | tuple[str, bytes]] = [
        (f"{PREFIX}/f{i}.txt", b"") for i in range(6)
    ]
    with pytest.raises(AnalysisError) as error:
        read_snapshot(tarball_from_entries(entries), limits(max_files=5))
    assert error.value.code == "too_many_files"


def test_fails_past_the_total_source_limit() -> None:
    entries: list[tarfile.TarInfo | tuple[str, bytes]] = [
        (f"{PREFIX}/f{i}.ts", b"// padding\n" * 60_000) for i in range(2)
    ]
    with pytest.raises(AnalysisError) as error:
        read_snapshot(tarball_from_entries(entries), limits(max_total_source_mb=1))
    assert error.value.code == "too_large"


def test_bounds_decompression_by_declared_sizes() -> None:
    # Highly compressible: tiny download, large when unpacked.
    archive = tarball_from_entries([(f"{PREFIX}/zeros.bin", b"\0" * (2 * 1024 * 1024))])
    with pytest.raises(AnalysisError) as error:
        read_snapshot(archive, limits(max_unpacked_mb=1))
    assert error.value.code == "too_large"


def test_rejects_data_that_isnt_a_tarball() -> None:
    import io

    with pytest.raises(AnalysisError) as error:
        read_snapshot(io.BytesIO(b"<html>not an archive</html>"), limits())
    assert error.value.code == "unsafe_archive"


def test_stops_at_the_deadline() -> None:
    with pytest.raises(AnalysisError) as error:
        read_snapshot(tarball_from_directory("web-app"), limits(), deadline=time.monotonic() - 1)
    assert error.value.code == "timeout"
