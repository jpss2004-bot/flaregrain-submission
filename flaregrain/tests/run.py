#!/usr/bin/env python3
"""Checks for the Flaregrain build. Run from anywhere: python3 -I tests/run.py"""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = Path(__file__).resolve().parent / "fixture"
sys.path.insert(0, str(ROOT))
import build  # noqa: E402

failures = []


def expect(name, ok):
    print(("passed " if ok else "FAILED ") + name)
    if not ok:
        failures.append(name)


def refuses(root):
    try:
        build.render(root)
    except SystemExit:
        return True
    return False


page = build.render(FIXTURE)
expect("styles, script and data are filled in", "body{margin:0}" in page and "window.fixtureReady" in page and '"records"' in page)
expect("script files keep file-name order", page.index("first script") < page.index("second script"))
block = re.search(r'<script id="rehearsal-data" type="application/json">(.*?)</script>', page, re.S)
expect("a JSON string cannot close the script element", "\\u003c/script>alert(1)" in page and "</script>alert" not in page)
expect("the embedded JSON has no literal less-than sign", bool(block) and "<" not in block.group(1))
expect("<!--<script> in a JSON value is escaped and the JSON round-trips",
       bool(block) and "<!--" not in block.group(1) and "\\u003c!--\\u003cscript>" in block.group(1)
       and json.loads(block.group(1)) == json.loads((FIXTURE / "data" / "rehearsal-data.json").read_text(encoding="utf-8")))
expect("no placeholder is left", not build.PLACEHOLDER.search(page))

with tempfile.TemporaryDirectory() as tmp:
    broken = Path(tmp) / "broken"
    shutil.copytree(FIXTURE, broken)
    (broken / "data" / "rehearsal-data.json").unlink()
    expect("missing data file stops the build", refuses(broken))
    (broken / "data" / "rehearsal-data.json").write_text("{not json", encoding="utf-8")
    expect("broken JSON stops the build", refuses(broken))
    invalid_values = []
    for constant in ("NaN", "Infinity", "-Infinity"):
        (broken / "data" / "rehearsal-data.json").write_text('{"value": ' + constant + '}', encoding="utf-8")
        invalid_values.append(refuses(broken))
    expect("non-JSON numeric constants stop the build", all(invalid_values))

with tempfile.TemporaryDirectory() as tmp:
    template = Path(tmp) / "template"
    shutil.copytree(FIXTURE, template)
    shell = template / "app" / "shell.html"
    original = shell.read_text(encoding="utf-8")
    shell.write_text(original.replace("{{APP}}", ""), encoding="utf-8")
    expect("missing application placeholder stops the build", refuses(template))
    shell.write_text(original, encoding="utf-8")
    data = template / "data" / "rehearsal-data.json"
    data.write_text(json.dumps({"note": "{{DATA:literal}}"}), encoding="utf-8")
    expect("placeholder text inside JSON stays literal", '"{{DATA:literal}}"' in build.render(template))
    script = template / "app" / "js" / "01-first.js"
    script.write_text('window.example = "</ScRiPt >";', encoding="utf-8")
    expect("unsafe markup in application JavaScript stops the build", refuses(template))
    script.write_text('window.example = "<\\/script>";', encoding="utf-8")
    css = template / "app" / "styles.css"
    css.write_text('main::after {content: "</style>";}', encoding="utf-8")
    expect("unsafe markup in CSS stops the build", refuses(template))

with tempfile.TemporaryDirectory() as tmp:
    build.build(FIXTURE, tmp)
    expect("build writes index.html to the chosen folder", (Path(tmp) / "index.html").is_file())
    expect("static files keep the paths the page uses", (Path(tmp) / "Vendor" / "fixture.txt").is_file())

with tempfile.TemporaryDirectory() as tmp:
    collision = Path(tmp) / "collision"
    shutil.copytree(FIXTURE, collision)
    (collision / "static" / "index.html").write_text("replacement page", encoding="utf-8")
    try:
        build.check(collision)
    except SystemExit as error:
        expect("static files cannot replace the generated page", "static/index.html" in str(error))
    else:
        expect("static files cannot replace the generated page", False)

# Verify the published Compare data survives the real application build.
if (ROOT / "app" / "shell.html").is_file():
    real = build.render(ROOT)
    embedded = re.search(r'<script id="compare-data" type="application/json">(.*?)</script>', real, re.S)
    expect("Compare mounts with its data", 'data-view="compare"' in real and embedded is not None)
    if embedded:
        data = json.loads(embedded.group(1))
        forward = data["pairs"]["B1,S1"]
        reverse = data["pairs"]["S1,B1"]
        expect("both pair orders preserve the selected records",
               [r["id"] for r in forward["records"]] == ["B1", "S1"]
               and [r["id"] for r in reverse["records"]] == ["S1", "B1"])
        expect("NASA sources point to their exact report pages",
               [s["url"].split("#")[-1] for s in forward["supportingSources"]] == ["page=111", "page=16", "page=29"])
        thickness = next(c for c in forward["conditions"][1] if c["label"] == "Sample thickness")
        expect("Saffire thickness preserves two separately sourced readings",
               thickness["tier"] == "dispute" and [r["value"] for r in thickness["readings"]]
               == ["0.37 mm", "0.37 under Sample Thickness (cm)"]
               and len({r["url"] for r in thickness["readings"]}) == 2)
        for pair in (forward, reverse):
            position = pair["ids"].index("S1")
            dimensions = next(c for c in pair["conditions"][position] if c["label"] == "Sample width and length")
            row_index = next(i for i, row in enumerate(pair["rows"]) if row[0] == "Specimen and conditions")
            expect("Saffire dimensions are disputed in the comparison and retain both sources",
                   dimensions["tier"] == "dispute"
                   and [r["value"] for r in dimensions["readings"]]
                   == ["40.6 cm wide × 94 cm long", "94 cm wide × 40.6 cm long"]
                   and len({r["url"] for r in dimensions["readings"]}) == 2
                   and pair["rowFlags"][row_index][position] == "dispute"
                   and "Dimensions disputed" in pair["rows"][row_index][position + 1])

# Moon & Mars air snapshot (data/moon-mars-air.json; the page reads the identical copy in redesign/, which the preview ships).
sys.path.insert(0, str(ROOT / "intake"))
import build_moon_mars_air as mma  # noqa: E402

snap_text = (ROOT / "data" / "moon-mars-air.json").read_text(encoding="utf-8")
snap = json.loads(snap_text)
expect("the page's snapshot copy is identical to data/moon-mars-air.json",
       (ROOT / "redesign" / "moon-mars-air.json").read_text(encoding="utf-8") == snap_text)
fields = {r["id"]: {f["field"]: f["value"] for f in r["fields"]} for r in json.loads((ROOT / "data" / "compare-data.json").read_text(encoding="utf-8"))["checked"]}
expect("the snapshot places all 13 checked records and each quoted oxygen and pressure is in that record's own field",
       sorted(c["id"] for c in snap["checkedRecords"]) == sorted(fields)
       and all(text in fields[c["id"]].get(field, "") for c in snap["checkedRecords"] for field, text in filter(None, c["read"].values())))
expect("checked-record values match a recomputation from the quoted fields", snap["checkedRecords"] == mma.checked_points())
expect("the seven presets are the demo's, in its order",
       len(snap["presets"]) == len(mma.PRESETS) == 7 and all({k: p[k] for k in q} == q for p, q in zip(snap["presets"], mma.PRESETS)))
recount = []
for p in snap["presets"]:
    pts = [c for c in snap["checkedRecords"] if c["o2"] is not None]
    near = [c["id"] for c in pts if c["psi"] is not None and abs(c["o2"] - p["o2"]) <= 3 and abs(c["psi"] - p["psi"]) <= 1.5]
    oxygen = [c["id"] for c in pts if c["psi"] is None and abs(c["o2"] - p["o2"]) <= 3]
    recount.append(p["checked"]["near"] == near and p["checked"]["oxygenOnly"] == oxygen
                   and p["near"]["rows"] == sum(i["rows"] for i in p["near"]["investigations"])
                   and p["oxygenOnly"]["rows"] == sum(i["rows"] for i in p["oxygenOnly"]["investigations"])
                   and 0 <= p["near"]["hotIgnition"]["ignited"] <= p["near"]["hotIgnition"]["known"] <= p["near"]["rows"]
                   and (p["near"]["rows"] > 0 or any(f["kind"] in ("outside", "interpolation") for f in p["flags"])))
expect("every preset's counts add up, its checked records recount, and an empty preset says it is untested", all(recount))
listed = {i["psi"] for p in snap["presets"] for part in ("near", "oxygenOnly") for i in p[part]["investigations"]}
expect("the snapshot holds no PSI-10 rows and no table rows", "PSI-10" not in listed
       and not any(k in p for p in snap["presets"] for k in ("rows", "points", "runs")))
# What the snapshot may name: the 23 PSI combustion investigations whose records carry CC0-1.0 (PSI-10's licence field is
# blank; NOTICE.md) and the 13 checked records. Its words may come only from its builder's own text and those names.
CC0 = {"PSI-20": "ACME BRE", "PSI-21": "ACME CLD Flame", "PSI-22": "ACME E-FIELD Flames", "PSI-23": "ACME s-Flame", "PSI-25": "BASS-II",
       "PSI-26": "BASS", "PSI-39": "CFI", "PSI-47": "DAFT / DAFT-2", "PSI-60": "Computational and Experimental Analysis of (PSI-60)",
       "PSI-62": "Concurrent Flame Spread Modeling using (PSI-62)", "PSI-68": "FLEX-2", "PSI-69": "FLEX", "PSI-98": "SAFFIRE-I",
       "PSI-99": "SAFFIRE-II", "PSI-100": "SAFFIRE-III", "PSI-101": "SAME-R", "PSI-102": "SAME", "PSI-106": "SLICE", "PSI-107": "SPICE",
       "PSI-115": "Utilization of the Smoke Aerosol (PSI-115)", "PSI-117": "Effect of External Thermo-Convective Perturbation (PSI-117)",
       "PSI-142": "Quantitative Studies of Cool Flame (PSI-142)", "PSI-159": "ACME CFI-G"}


def strings(node, key=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from strings(v, k)
    elif isinstance(node, list):
        for v in node:
            yield from strings(v, key)
    elif isinstance(node, str):
        yield key, node


named = [i for p in snap["presets"] for part in ("near", "oxygenOnly") for i in p[part]["investigations"]]
records_named = {c["id"] for c in snap["checkedRecords"]} | {i for p in snap["presets"] for i in
                 p["checked"]["near"] + p["checked"]["oxygenOnly"] + [x["id"] for x in p["checked"]["nearest"]]}
expect("the snapshot names only the 23 CC0 investigations and the 13 checked records",
       len(CC0) == 23 and all(CC0.get(i["psi"]) == i["name"] for i in named) and records_named == set(fields)
       and re.fullmatch(r"[0-9a-f]{64}", snap["source"]["catalogSha256"]) is not None)
vocab = set(re.findall(r"[A-Za-z]+", (ROOT / "intake" / "build_moon_mars_air.py").read_text(encoding="utf-8") + " " + " ".join(CC0.values())))
stray = {w for k, t in strings(snap) if k != "catalogSha256" for w in re.findall(r"[A-Za-z]+", t)} - vocab
expect("every word in the snapshot is its builder's own text or an allowed investigation name", not stray)
# The full recount needs the demo's catalog, which stays in the team's working repository. Point FLAREGRAIN_CATALOG at
# dashboard_catalog.json from the recorded commit; with the same SHA-256 the rebuild must equal the snapshot exactly.
catalog = Path(os.environ.get("FLAREGRAIN_CATALOG", ROOT / "intake" / "data" / "dashboard_catalog.json"))
if catalog.is_file() and hashlib.sha256(catalog.read_bytes()).hexdigest() == snap["source"]["catalogSha256"]:
    rebuilt = mma.snapshot(json.loads(catalog.read_bytes()), snap["source"]["catalogSha256"])
    expect("the snapshot equals a full recount from the demo's catalog", rebuilt == snap)
else:
    print("note   full Moon & Mars air recount skipped: set FLAREGRAIN_CATALOG to the demo's catalog at " + snap["source"]["commit"])

status = subprocess.run([sys.executable, "-I", str(ROOT / "build.py"), "--check"], capture_output=True, text=True)
expect("build.py --check runs from the command line", status.returncode == 0)

# Live Explain in redesign/server.mjs, against a stand-in model proxy on this computer (tests/live_explain.mjs).
node = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if Path(p).is_file()), None)
if node is None:
    expect("live Explain checks run (needs Node.js 22 or later)", False)
else:
    try:
        live = subprocess.run([node, str(ROOT / "tests" / "live_explain.mjs")], capture_output=True, text=True, timeout=120)
        lines = [line for line in live.stdout.splitlines() if line.startswith(("passed ", "FAILED "))]
        for line in lines:
            expect(line.split(" ", 1)[1], line.startswith("passed "))
        expect("live Explain checks complete", live.returncode == 0 and bool(lines))
    except subprocess.TimeoutExpired:
        expect("live Explain checks complete", False)

# Model-written Ask in redesign/server.mjs, off by default, against a stand-in model proxy (tests/live_ask.mjs).
if node is not None:
    try:
        ask = subprocess.run([node, str(ROOT / "tests" / "live_ask.mjs")], capture_output=True, text=True, timeout=120)
        lines = [line for line in ask.stdout.splitlines() if line.startswith(("passed ", "FAILED "))]
        for line in lines:
            expect(line.split(" ", 1)[1], line.startswith("passed "))
        expect("model Ask checks complete", ask.returncode == 0 and bool(lines))
    except subprocess.TimeoutExpired:
        expect("model Ask checks complete", False)

print(f"{len(failures)} failed" if failures else "all build checks passed")
sys.exit(1 if failures else 0)
