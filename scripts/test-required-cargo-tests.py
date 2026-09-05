import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "required_tests", Path(__file__).with_name("run-required-cargo-tests.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RequiredTests(unittest.TestCase):
    def test_rejects_empty_and_stale_filters(self):
        for listing in ("", "0 tests, 0 benchmarks\n", "Finished test profile\n"):
            self.assertFalse(module.has_selected_tests(listing))

    def test_accepts_real_test_names_not_benchmarks(self):
        self.assertTrue(module.has_selected_tests("commands::tests::valid_scope: test\n1 test, 0 benchmarks"))
        self.assertFalse(module.has_selected_tests("sample: benchmark\n0 tests, 1 benchmark"))


if __name__ == "__main__":
    unittest.main()
