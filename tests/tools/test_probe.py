"""CLI checks for the read-only probe; no serial hardware is accessed."""
import contextlib
import io
from pathlib import Path
import runpy
import sys
import types
import unittest
from unittest.mock import Mock, patch

PROBE = Path(__file__).resolve().parents[2] / "tools" / "probe.py"


class StopProbe(Exception):
    pass


class ProbeCliTests(unittest.TestCase):
    def run_probe(self, *arguments):
        serial = types.ModuleType("serial")
        serial.Serial = Mock(side_effect=StopProbe)
        output = io.StringIO()
        with patch.dict(sys.modules, serial=serial), patch.object(sys, "argv", ["probe.py", *arguments]):
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                try:
                    runpy.run_path(str(PROBE), run_name="__main__")
                except (SystemExit, StopProbe) as result:
                    return result, serial.Serial, output.getvalue()
        self.fail("Expected CLI exit or serial connection")

    def test_port_is_required_without_accessing_hardware(self):
        result, connect, output = self.run_probe()
        self.assertIsInstance(result, SystemExit)
        self.assertEqual(result.code, 2)
        connect.assert_not_called()
        self.assertIn("port", output)

    def test_help_does_not_access_hardware(self):
        result, connect, output = self.run_probe("--help")
        self.assertIsInstance(result, SystemExit)
        self.assertEqual(result.code, 0)
        connect.assert_not_called()
        self.assertIn("port", output)

    def test_explicit_port_baud_and_slave_are_accepted(self):
        result, connect, _ = self.run_probe("SERIAL_PORT", "19200", "2")
        self.assertIsInstance(result, StopProbe)
        connect.assert_called_once_with("SERIAL_PORT", 19200, 8, "N", 1, timeout=0.5)


if __name__ == "__main__":
    unittest.main()
