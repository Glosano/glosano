"""The compatibility protocol accepts native PowerShell's UTF-8 BOM."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

class UpdateCheckTests(unittest.TestCase):
    def test_utf8_bom_input(self):
        def config(version):
            return {'name':'example', 'services':{
                **{role:{'image':role+':1'} for role in ('postgres','redis')},
                **{role:{'image':'ghcr.io/glosano/glosano:'+version} for role in ('app-api','app-worker','migrate')},
            }}
        payload=json.dumps({'old':config('v0.0.4'),'new':config('v0.0.5'),'source':'v0.0.4','target':'v0.0.5'}).encode('utf-8-sig')
        result=subprocess.run([sys.executable,str(Path(__file__).resolve().parents[1]/'update-check.py')],input=payload,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)
