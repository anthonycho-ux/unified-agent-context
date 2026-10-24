"""Unit tests for agent_context.detect (room change detection).

Run:  .venv-vlm/bin/python -m unittest discover -s tests/python -v
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from agent_context.detect import (  # noqa: E402
    CONTRACT_KEYS,
    MockClient,
    _fixtures,
    compare_frames,
    detect_change,
    parse_json_object,
)


class FixtureCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = tempfile.TemporaryDirectory(prefix="roomdiff-test-")
        cls.fx = _fixtures(Path(cls._tmp.name))

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmp.cleanup()


class TestPreFilter(FixtureCase):
    def test_identical_is_unchanged(self) -> None:
        r = compare_frames(*self.fx["identical"])
        self.assertFalse(r.changed)
        self.assertLess(r.score, 0.005)
        self.assertGreater(r.ssim, 0.99)

    def test_soft_lighting_is_absorbed(self) -> None:
        r = compare_frames(*self.fx["lighting_soft"])
        self.assertFalse(r.changed, f"score={r.score}")

    def test_blown_highlights_stay_under_budget(self) -> None:
        r = compare_frames(*self.fx["lighting_blown"])
        self.assertFalse(r.changed, f"score={r.score}")

    def test_added_object_detected_and_localised(self) -> None:
        r = compare_frames(*self.fx["added"])
        self.assertTrue(r.changed)
        self.assertGreater(r.score, 0.02)
        self.assertIn("right", r.region)
        self.assertIsNotNone(r.bbox)

    def test_moved_object_detected(self) -> None:
        r = compare_frames(*self.fx["moved"])
        self.assertTrue(r.changed)

    def test_threshold_is_respected(self) -> None:
        before, after = self.fx["added"]
        self.assertFalse(compare_frames(before, after, threshold=0.5).changed)
        self.assertTrue(compare_frames(before, after, threshold=0.001).changed)

    def test_geometry_mismatch_is_handled(self) -> None:
        before, after = self.fx["added"]
        img = cv2.imread(str(after))
        small = cv2.resize(img, (img.shape[1] // 2, img.shape[0] // 2))
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as fh:
            cv2.imwrite(fh.name, small)
            r = compare_frames(before, Path(fh.name))
        self.assertTrue(r.changed)
        self.assertTrue(any("resized" in n for n in r.notes))

    def test_mask_is_written(self) -> None:
        out = Path(self._tmp.name) / "mask.png"
        compare_frames(*self.fx["added"], mask_out=out)
        self.assertTrue(out.exists())
        mask = cv2.imread(str(out), cv2.IMREAD_GRAYSCALE)
        self.assertEqual(int((mask > 0).sum()) > 0, True)

    def test_missing_file_raises(self) -> None:
        with self.assertRaises(FileNotFoundError):
            compare_frames(Path(self._tmp.name) / "nope.png", self.fx["added"][1])


class TestParsing(unittest.TestCase):
    def test_plain(self) -> None:
        self.assertEqual(parse_json_object('{"changed": true}'), {"changed": True})

    def test_fenced(self) -> None:
        self.assertIsNotNone(parse_json_object('```json\n{"changed": false}\n```'))

    def test_prose_wrapped(self) -> None:
        obj = parse_json_object('Sure! {"changed": true, "summary": "mug"} hope that helps')
        assert obj is not None
        self.assertEqual(obj["summary"], "mug")

    def test_nested_braces_in_strings(self) -> None:
        obj = parse_json_object('{"summary": "the box {big} moved", "changed": true}')
        assert obj is not None
        self.assertEqual(obj["summary"], "the box {big} moved")

    def test_trailing_comma(self) -> None:
        self.assertIsNotNone(parse_json_object('{"changed": true, "objects_added": ["mug",],}'))

    def test_garbage(self) -> None:
        self.assertIsNone(parse_json_object("no json here"))
        self.assertIsNone(parse_json_object(""))


class TestCascade(FixtureCase):
    def test_contract_keys_only(self) -> None:
        out = detect_change(*self.fx["added"], backend="mock", include_meta=False)
        self.assertEqual(set(out), set(CONTRACT_KEYS))

    def test_meta_attached(self) -> None:
        out = detect_change(*self.fx["added"], backend="mock")
        self.assertIn("_meta", out)
        self.assertEqual(out["_meta"]["cascade"], ["describe"])
        self.assertEqual(len(out["_meta"]["calls"]), 1)

    def test_gate_can_be_enabled(self) -> None:
        out = detect_change(*self.fx["added"], backend="mock", gate=True)
        self.assertEqual(out["_meta"]["cascade"], ["gate", "describe"])
        self.assertTrue(out["changed"])

    def test_gate_no_short_circuits(self) -> None:
        out = detect_change(
            *self.fx["added"], backend="mock", gate=True,
            client_factory=lambda b, role="describe", **kw: MockClient(no_change=True))
        self.assertFalse(out["changed"])
        self.assertEqual(out["_meta"]["verdict_source"], "gate")
        self.assertEqual(out["_meta"]["cascade"], ["gate"])

    def test_prefilter_short_circuit(self) -> None:
        out = detect_change(*self.fx["identical"], backend="mock")
        self.assertFalse(out["changed"])
        self.assertEqual(out["_meta"]["cascade"], ["prefilter:skip"])
        self.assertEqual(out["_meta"]["calls"], [])

    def test_detail_pass(self) -> None:
        out = detect_change(*self.fx["added"], backend="mock", detail=True)
        self.assertEqual(out["_meta"]["cascade"], ["detail"])
        self.assertEqual(out["_meta"]["verdict_source"], "detail")

    def test_unparseable_keeps_prefilter_verdict(self) -> None:
        out = detect_change(
            *self.fx["added"], backend="mock",
            client_factory=lambda b, role="describe", **kw: MockClient(broken_json=True))
        self.assertTrue(out["changed"])
        self.assertTrue(out["_meta"].get("parse_failed"))

    def test_backend_error_degrades_to_prefilter(self) -> None:
        def boom(b, role="describe", **kw):
            from agent_context.detect import BackendError
            raise BackendError("no runtime")

        out = detect_change(*self.fx["added"], backend="mock", client_factory=boom)
        self.assertTrue(out["changed"])
        self.assertEqual(out["_meta"]["verdict_source"], "prefilter-only")
        self.assertIn("no runtime", out["_meta"]["error"])

    def test_output_is_json_serialisable(self) -> None:
        out = detect_change(*self.fx["moved"], backend="mock")
        json.dumps(out)  # must not raise


class TestCameraLoop(FixtureCase):
    def _video(self, n_before: int = 3, n_after: int = 3) -> Path:
        before = cv2.imread(str(self.fx["added"][0]))
        after = cv2.imread(str(self.fx["added"][1]))
        h, w = before.shape[:2]
        path = Path(self._tmp.name) / "loop.avi"
        vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 5, (w, h))
        self.assertTrue(vw.isOpened())
        for _ in range(n_before):
            vw.write(before)
        for _ in range(n_after):
            vw.write(after)
        vw.release()
        return path

    def test_loop_yields_one_event(self) -> None:
        from agent_context.detect import iter_camera_changes

        events = list(iter_camera_changes(self._video(), backend="mock", max_frames=6))
        self.assertEqual(len(events), 1)
        self.assertTrue(events[0]["changed"])

    def test_loop_once_stops_early(self) -> None:
        from agent_context.detect import iter_camera_changes

        events = list(iter_camera_changes(self._video(), backend="mock", once=True))
        self.assertEqual(len(events), 1)

    def test_bad_source_raises(self) -> None:
        from agent_context.detect import BackendError, iter_camera_changes

        with self.assertRaises(BackendError):
            list(iter_camera_changes(Path(self._tmp.name) / "nope.avi"))


if __name__ == "__main__":
    unittest.main()
