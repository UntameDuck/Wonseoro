"""호환 실행기. 실제 생성 로직은 Node 스크립트가 단일 원본이다."""
import subprocess
import sys
from pathlib import Path

script = Path(__file__).with_suffix('.mjs')
raise SystemExit(subprocess.call(['node', str(script), *sys.argv[1:]]))
