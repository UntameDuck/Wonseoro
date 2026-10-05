import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("render-submission-errata.py")
SPEC = importlib.util.spec_from_file_location("render_submission_errata", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FindFontsTest(unittest.TestCase):
    def test_prefers_complete_environment_override(self):
        environment = {
            MODULE.FONT_ENV_REGULAR: "C:/fonts/custom-regular.ttf",
            MODULE.FONT_ENV_BOLD: "C:/fonts/custom-bold.ttf",
        }

        self.assertEqual(
            MODULE.find_fonts(environment, lambda path: path.name.startswith("custom-")),
            (Path("C:/fonts/custom-regular.ttf"), Path("C:/fonts/custom-bold.ttf")),
        )

    def test_rejects_partial_environment_override(self):
        with self.assertRaisesRegex(ValueError, "함께 지정"):
            MODULE.find_fonts({MODULE.FONT_ENV_REGULAR: "/fonts/regular.ttf"}, lambda _path: True)

    def test_rejects_missing_environment_override(self):
        environment = {
            MODULE.FONT_ENV_REGULAR: "/fonts/missing-regular.ttf",
            MODULE.FONT_ENV_BOLD: "/fonts/missing-bold.ttf",
        }

        with self.assertRaisesRegex(FileNotFoundError, "지정한 한글 글꼴"):
            MODULE.find_fonts(environment, lambda _path: False)

    def test_selects_first_complete_candidate_pair(self):
        expected = MODULE.FONT_CANDIDATES[1]
        existing = set(expected)

        self.assertEqual(MODULE.find_fonts({}, lambda path: path in existing), expected)

    def test_rejects_when_no_candidate_pair_exists(self):
        with self.assertRaisesRegex(FileNotFoundError, MODULE.FONT_ENV_REGULAR):
            MODULE.find_fonts({}, lambda _path: False)


if __name__ == "__main__":
    unittest.main()
