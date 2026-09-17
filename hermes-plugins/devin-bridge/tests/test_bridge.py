"""Unit tests for the devin-bridge core: python3 -m unittest discover hermes-plugins/devin-bridge/tests"""

import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bridge  # noqa: E402


class FakeDevin:
    """Records argv/cwd and replays scripted (returncode, stdout, stderr) results."""

    def __init__(self, reply="hello from devin", listing='[{"id": "sess-1", "updated_at": 2}]'):
        self.calls = []
        self.reply = reply
        self.listing = listing
        self.raise_with = None

    def __call__(self, argv, cwd, timeout):
        self.calls.append({"argv": argv, "cwd": cwd, "timeout": timeout})
        if self.raise_with is not None:
            raise self.raise_with
        if "list" in argv:
            return 0, self.listing, ""
        return 0, self.reply, ""


def make_engine(runner, workspace, **config):
    settings = {"workspace": workspace, "devin_bin": "devin-fake"}
    settings.update(config)
    store = bridge.ThreadStore(os.path.join(workspace, "state", "threads.json"))
    return bridge.DevinBridge(config_getter=lambda: settings, store=store, runner=runner)


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.workspace = self.tmp.name
        self.addCleanup(self.tmp.cleanup)

    def test_first_turn_starts_session_and_binds_it(self):
        fake = FakeDevin()
        engine = make_engine(fake, self.workspace)

        result = engine.ask("telegram:42", "hi")

        self.assertEqual(result["reply"], "hello from devin")
        self.assertEqual(result["session_id"], "sess-1")
        self.assertTrue(result["new_session"])
        self.assertNotIn("--resume", fake.calls[0]["argv"])
        self.assertEqual(fake.calls[0]["cwd"], self.workspace)

    def test_second_turn_resumes_bound_session(self):
        fake = FakeDevin()
        engine = make_engine(fake, self.workspace)
        engine.ask("telegram:42", "hi")

        result = engine.ask("telegram:42", "and now?")

        argv = fake.calls[-1]["argv"]
        self.assertIn("--resume", argv)
        self.assertEqual(argv[argv.index("--resume") + 1], "sess-1")
        self.assertFalse(result["new_session"])

    def test_threads_are_isolated(self):
        fake = FakeDevin(listing='[{"id": "sess-1", "updated_at": 2}]')
        engine = make_engine(fake, self.workspace)
        engine.ask("telegram:42", "hi")
        fake.listing = '[{"id": "sess-2", "updated_at": 9}, {"id": "sess-1", "updated_at": 2}]'

        other = engine.ask("discord:7", "hi")

        self.assertEqual(other["session_id"], "sess-2")
        self.assertEqual(engine.status("telegram:42")["session_id"], "sess-1")

    def test_new_session_flag_drops_binding(self):
        fake = FakeDevin()
        engine = make_engine(fake, self.workspace)
        engine.ask("cli:1", "hi")

        engine.ask("cli:1", "start over", new_session=True)

        self.assertNotIn("--resume", fake.calls[-1]["argv"])

    def test_reset_unbinds(self):
        engine = make_engine(FakeDevin(), self.workspace)
        engine.ask("cli:1", "hi")

        self.assertTrue(engine.reset("cli:1")["reset"])
        self.assertIsNone(engine.status("cli:1")["session_id"])

    def test_undiscoverable_session_falls_back_to_continue(self):
        fake = FakeDevin(listing="not json")
        engine = make_engine(fake, self.workspace)
        engine.ask("cli:1", "hi")

        engine.ask("cli:1", "again")

        second_ask = [call for call in fake.calls if "list" not in call["argv"]][1]
        self.assertIn("--continue", second_ask["argv"])

    def test_timeout_and_missing_binary_return_errors(self):
        fake = FakeDevin()
        engine = make_engine(fake, self.workspace, timeout=5)
        fake.raise_with = subprocess.TimeoutExpired(cmd="devin", timeout=5)
        self.assertIn("within 5s", engine.ask("cli:1", "hi")["error"])

        fake.raise_with = FileNotFoundError()
        self.assertIn("binary not found", engine.ask("cli:1", "hi")["error"])

    def test_missing_workspace_is_reported(self):
        engine = make_engine(FakeDevin(), os.path.join(self.workspace, "nope"))
        self.assertIn("workspace does not exist", engine.ask("cli:1", "hi")["error"])

    def test_ansi_is_stripped_from_replies(self):
        engine = make_engine(FakeDevin(reply="\x1b[1mbold\x1b[0m answer\r\n"), self.workspace)
        self.assertEqual(engine.ask("cli:1", "hi")["reply"], "bold answer")

    def test_model_and_permission_mode_are_passed_through(self):
        fake = FakeDevin()
        engine = make_engine(fake, self.workspace, model="opus", permission_mode="accept-edits")

        engine.ask("cli:1", "hi")

        argv = fake.calls[0]["argv"]
        self.assertEqual(argv[argv.index("--model") + 1], "opus")
        self.assertEqual(argv[argv.index("--permission-mode") + 1], "accept-edits")


class PickLatestSessionTest(unittest.TestCase):
    def test_accepts_alternate_key_names_and_envelope(self):
        self.assertEqual(
            bridge.pick_latest_session({"sessions": [{"sessionId": "a", "last_updated": "2026-01-01"}]}), "a"
        )

    def test_returns_none_on_garbage(self):
        self.assertIsNone(bridge.pick_latest_session([{"no_id": 1}]))
        self.assertIsNone(bridge.pick_latest_session("nope"))


if __name__ == "__main__":
    unittest.main()
