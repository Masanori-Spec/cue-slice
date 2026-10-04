#!/usr/bin/env python3
"""Deterministic source archive and independently checkable SHA-256 manifest."""
from pathlib import Path
import hashlib,json,zipfile
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'cue-slice-output'
OUT.mkdir(exist_ok=True)
EXCLUDE={'node_modules','.venv','.git','test-results','__pycache__'}
files=sorted(p for p in ROOT.rglob('*') if p.is_file() and not any(x in EXCLUDE for x in p.relative_to(ROOT).parts))
records=[]
archive=OUT/'cue-slice-source.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p in files:
        rel=p.relative_to(ROOT).as_posix();data=p.read_bytes()
        info=zipfile.ZipInfo('cue-slice/'+rel,date_time=(1980,1,1,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED
        info.external_attr=0o100644<<16
        z.writestr(info,data)
        records.append({'path':rel,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    manifest={'version':1,'root':'cue-slice','files':records}
    info=zipfile.ZipInfo('cue-slice/SOURCE-MANIFEST.json',date_time=(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
    z.writestr(info,json.dumps(manifest,indent=2)+'\n')
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for r in records:
        assert hashlib.sha256(z.read('cue-slice/'+r['path'])).hexdigest()==r['sha256']
manifest.update({'archive':archive.name,'archiveBytes':archive.stat().st_size,'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'verified':True})
(OUT/'cue-slice-source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({k:v for k,v in manifest.items() if k!='files'}))
