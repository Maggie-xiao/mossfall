from __future__ import annotations

import hashlib
import json
import math
import subprocess
import tempfile
import wave
from datetime import datetime, timezone
from pathlib import Path

import imageio_ffmpeg
import numpy as np
import soundfile as sf


ROOT = Path(__file__).resolve().parents[1]
BGM_DIR = ROOT / "src" / "audio" / "bgm"
SOURCE = BGM_DIR / "_source" / "Balance Beam.wav"
OUTPUT = BGM_DIR / "balance-beam-loop.ogg"
PREVIEW = BGM_DIR / "_validation" / "bgm-balance-beam-loop-preview.ogg"
MANIFEST = BGM_DIR / "bgm-sources.json"
REPORT = BGM_DIR / "loop-validation.json"
CROSSFADE_SECONDS = 5.0
PREVIEW_CYCLES = 4


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def dbfs(value: float) -> float:
    return 20.0 * math.log10(max(value, 1e-12))


def spectral_distance(left: np.ndarray, right: np.ndarray) -> float:
    size = min(left.size, right.size)
    window = np.hanning(size)
    left_spectrum = np.log1p(np.abs(np.fft.rfft((left[:size] - left[:size].mean()) * window)))
    right_spectrum = np.log1p(np.abs(np.fft.rfft((right[:size] - right[:size].mean()) * window)))
    left_norm = np.linalg.norm(left_spectrum)
    right_norm = np.linalg.norm(right_spectrum)
    if left_norm > 1e-12:
        left_spectrum /= left_norm
    if right_norm > 1e-12:
        right_spectrum /= right_norm
    return float(np.linalg.norm(left_spectrum - right_spectrum) / 2.0)


def seam_metrics(data: np.ndarray, sample_rate: int) -> dict[str, float]:
    mono = data.mean(axis=1)
    window_size = max(64, min(int(sample_rate * 0.05), mono.size // 4))
    tail = mono[-window_size:]
    head = mono[:window_size]
    jump = abs(float(mono[0] - mono[-1]))
    internal_jumps = np.abs(np.diff(mono))
    reference_jump = float(np.percentile(internal_jumps, 95))
    tail_rms = math.sqrt(float(np.mean(np.square(tail, dtype=np.float64))))
    head_rms = math.sqrt(float(np.mean(np.square(head, dtype=np.float64))))
    return {
        "boundary_jump_dbfs": round(dbfs(jump), 3),
        "boundary_jump_ratio": round(jump / max(reference_jump, 1e-8), 6),
        "rms_delta_db": round(abs(dbfs(tail_rms) - dbfs(head_rms)), 3),
        "spectral_distance": round(spectral_distance(tail, head), 6),
    }


def run_ffmpeg(*arguments: str) -> None:
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(),
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        *arguments,
    ]
    subprocess.run(command, check=True)


def concatenate_wav(first_path: Path, second_path: Path, output_path: Path) -> None:
    with wave.open(str(first_path), "rb") as first, wave.open(
        str(second_path), "rb"
    ) as second:
        first_format = (
            first.getnchannels(),
            first.getsampwidth(),
            first.getframerate(),
            first.getcomptype(),
        )
        second_format = (
            second.getnchannels(),
            second.getsampwidth(),
            second.getframerate(),
            second.getcomptype(),
        )
        if first_format != second_format:
            raise RuntimeError("Prepared WAV segments do not share one PCM format")
        with wave.open(str(output_path), "wb") as output:
            output.setnchannels(first.getnchannels())
            output.setsampwidth(first.getsampwidth())
            output.setframerate(first.getframerate())
            output.setcomptype(first.getcomptype(), first.getcompname())
            output.writeframes(first.readframes(first.getnframes()))
            output.writeframes(second.readframes(second.getnframes()))


def main() -> None:
    source_info = sf.info(SOURCE)
    sample_rate = source_info.samplerate
    source_duration = source_info.frames / sample_rate
    if source_duration <= CROSSFADE_SECONDS * 2:
        raise RuntimeError("Source is too short for the configured crossfade")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="balance-beam-", dir=BGM_DIR) as temp:
        temp_dir = Path(temp)
        head = temp_dir / "head.wav"
        tail = temp_dir / "tail.wav"
        blend = temp_dir / "blend.wav"
        middle = temp_dir / "middle.wav"
        loop_wav = temp_dir / "loop.wav"
        output_ogg = temp_dir / OUTPUT.name
        preview_ogg = temp_dir / PREVIEW.name
        middle_duration = source_duration - CROSSFADE_SECONDS * 2
        tail_start = source_duration - CROSSFADE_SECONDS

        run_ffmpeg(
            "-ss",
            "0",
            "-t",
            str(CROSSFADE_SECONDS),
            "-i",
            str(SOURCE),
            "-c:a",
            "pcm_s16le",
            str(head),
        )
        run_ffmpeg(
            "-ss",
            str(tail_start),
            "-t",
            str(CROSSFADE_SECONDS),
            "-i",
            str(SOURCE),
            "-c:a",
            "pcm_s16le",
            str(tail),
        )
        run_ffmpeg(
            "-i",
            str(tail),
            "-i",
            str(head),
            "-filter_complex",
            (
                f"[0:a][1:a]acrossfade=d={CROSSFADE_SECONDS}:"
                "c1=qsin:c2=qsin[out]"
            ),
            "-map",
            "[out]",
            "-c:a",
            "pcm_s16le",
            str(blend),
        )
        run_ffmpeg(
            "-ss",
            str(CROSSFADE_SECONDS),
            "-t",
            str(middle_duration),
            "-i",
            str(SOURCE),
            "-c:a",
            "pcm_s16le",
            str(middle),
        )
        concatenate_wav(blend, middle, loop_wav)
        run_ffmpeg(
            "-i",
            str(loop_wav),
            "-c:a",
            "libvorbis",
            "-q:a",
            "5",
            str(output_ogg),
        )
        run_ffmpeg(
            "-stream_loop",
            str(PREVIEW_CYCLES - 1),
            "-i",
            str(output_ogg),
            "-c:a",
            "libvorbis",
            "-q:a",
            "5",
            str(preview_ogg),
        )
        output_ogg.replace(OUTPUT)
        preview_ogg.replace(PREVIEW)

    output, sample_rate = sf.read(OUTPUT, dtype="float32", always_2d=True)
    metrics = seam_metrics(output, sample_rate)
    duration = output.shape[0] / sample_rate
    output_hash = sha256(OUTPUT)
    preview_hash = sha256(PREVIEW)
    quality_passed = (
        (
            metrics["boundary_jump_dbfs"] <= -30
            or metrics["boundary_jump_ratio"] <= 1.25
        )
        and metrics["rms_delta_db"] <= 2
        and metrics["spectral_distance"] <= 0.35
    )
    if not quality_passed:
        raise RuntimeError(f"Loop seam failed quality thresholds: {metrics}")

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    asset = manifest["assets"][0]
    analysis = {
        "duration_seconds": round(duration, 6),
        "sample_rate": sample_rate,
        "channels": output.shape[1],
        "peak": round(float(np.max(np.abs(output))), 6),
        "rms_dbfs": round(dbfs(math.sqrt(float(np.mean(np.square(output, dtype=np.float64))))), 3),
    }
    loop = {
        "key": asset["key"],
        "mode": "seamless-loop",
        "source_file": asset["source_file"],
        "file": asset["file"],
        "source_start_seconds": 0,
        "source_end_seconds": round(source_duration, 6),
        "output_duration_seconds": round(duration, 6),
        "crossfade_ms": CROSSFADE_SECONDS * 1000,
        **metrics,
        "validation_cycles": PREVIEW_CYCLES,
        "quality_passed": True,
        "preview_file": PREVIEW.relative_to(BGM_DIR).as_posix(),
        "preview_sha256": preview_hash,
    }
    asset["bytes"] = OUTPUT.stat().st_size
    asset["sha256"] = output_hash
    asset["analysis"] = analysis
    asset["loop"] = loop
    manifest["production"].update(
        {
            "bytes": OUTPUT.stat().st_size,
            "sha256": output_hash,
            "duration_seconds": round(duration, 6),
            "sample_rate": sample_rate,
            "channels": output.shape[1],
            "loop_processing": loop,
        }
    )
    MANIFEST.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    report = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "target_html": str(ROOT / "src" / "index.html"),
        "manifest": str(MANIFEST),
        "results": [loop],
        "failures": [],
    }
    REPORT.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(OUTPUT), "duration": duration, **metrics}))


if __name__ == "__main__":
    main()
