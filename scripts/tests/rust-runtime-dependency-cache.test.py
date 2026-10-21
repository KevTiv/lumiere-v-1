#!/usr/bin/env python3
"""Isolated compilation proof; never builds or runs service binaries."""
import argparse
import json, os
from pathlib import Path
import shutil, subprocess, tempfile, time
parser = argparse.ArgumentParser(description="Verify real release-profile dependency reuse and dummy replacement using cargo-chef 0.1.73. Requires cached itoa 1.0.17 and 1.0.18 for offline builds.")
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
EVIDENCE = args.output.resolve()
EVIDENCE.mkdir(parents=True, exist_ok=True)
ENV = dict(os.environ)
ENV.pop('CARGO_TARGET_DIR',None)
def run(cwd,name,args):
    start=time.monotonic()
    p=subprocess.run(args,cwd=cwd,env=ENV,text=True,capture_output=True)
    (EVIDENCE/(name+'.log')).write_text(p.stdout+p.stderr)
    if p.returncode: raise RuntimeError(name+' failed: '+p.stderr[-3000:])
    return dict(seconds=round(time.monotonic()-start,3),stdout=p.stdout,log=p.stderr)
with tempfile.TemporaryDirectory(prefix='lumiere-chef-') as d:
    root=Path(d); src=root/'planner'; src.mkdir(); (src/'src').mkdir()
    manifest='[package]\nname="cache-proof"\nversion="1.2.3"\nedition="2021"\nbuild="build.rs"\n[dependencies]\nitoa="=1.0.18"\n[profile.release]\nopt-level=3\nlto=true\n'
    (src/'Cargo.toml').write_text(manifest)
    (src/'build.rs').write_text('fn main() { println!("cargo:rustc-env=BUILD_PROOF=real-build-script"); }')
    def source(n): return 'fn main(){let mut b=itoa::Buffer::new();println!("{}:{}",env!("BUILD_PROOF"),b.format('+str(n)+'));}'
    (src/'src/main.rs').write_text(source(41))
    run(src,'lock',['cargo','generate-lockfile','--offline'])
    run(src,'prepare1',['cargo','chef','prepare','--recipe-path','recipe.json'])
    r1=(src/'recipe.json').read_bytes()
    (src/'src/main.rs').write_text(source(42))
    run(src,'prepare2',['cargo','chef','prepare','--recipe-path','recipe.json'])
    assert (src/'recipe.json').read_bytes()==r1,'source body invalidated dependency recipe'
    # Cook in a clean directory, exactly like the dependency stage.
    build=root/'builder'; build.mkdir(); shutil.copy(src/'recipe.json',build/'recipe.json')
    cold=run(build,'cold-cook',['cargo','chef','cook','--locked','--offline','--release','--recipe-path','recipe.json','-p','cache-proof','--bin','cache-proof'])
    for f in ('Cargo.toml','Cargo.lock','build.rs'): shutil.copy2(src/f,build/f)
    shutil.copytree(src/'src',build/'src',dirs_exist_ok=True)
    real=run(build,'real-build',['cargo','build','--release','--locked','--offline','-vv'])
    assert 'Fresh itoa v1.0.18' in real['log'],'third-party dependency was recompiled'
    actual=run(build,'run-real',[str(build/'target/release/cache-proof')])
    assert actual['stdout'].strip()=='real-build-script:42',actual
    (build/'src/main.rs').write_text(source(43))
    warm=run(build,'warm-source-build',['cargo','build','--release','--locked','--offline','-vv'])
    assert 'Fresh itoa v1.0.18' in warm['log']
    assert run(build,'run-changed',[str(build/'target/release/cache-proof')])['stdout'].strip()=='real-build-script:43'
    (src/'Cargo.toml').write_text(manifest.replace('lto=true','lto=false'))
    run(src,'prepare-profile',['cargo','chef','prepare','--recipe-path','recipe.json'])
    assert (src/'recipe.json').read_bytes()!=r1,'profile change failed to invalidate recipe'
    (src/'Cargo.toml').write_text(manifest.replace('=1.0.18','=1.0.17'))
    run(src,'lock-change',['cargo','generate-lockfile','--offline'])
    run(src,'prepare-dependency',['cargo','chef','prepare','--recipe-path','recipe.json'])
    r2=(src/'recipe.json').read_bytes()
    assert r2!=r1,'dependency change failed to invalidate recipe'
    shutil.copy(src/'recipe.json',build/'recipe.json')
    changed=run(build,'changed-dependency-cook',['cargo','chef','cook','--locked','--offline','--release','--recipe-path','recipe.json','-p','cache-proof','--bin','cache-proof'])
    assert 'Compiling itoa v1.0.17' in changed['log'],'changed dependency was not compiled'
    results={name:{'seconds':r['seconds']} for name,r in [('cold_cook',cold),('real_build',real),('warm_source_build',warm),('dependency_changed_cook',changed)]}
    results.update(source_body_recipe_stable=True,real_build_script_and_application_verified=True,third_party_dependency_fresh=True,release_profile_invalidates=True,dependency_change_invalidates=True)
    (EVIDENCE/'result.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps(results,indent=2))
