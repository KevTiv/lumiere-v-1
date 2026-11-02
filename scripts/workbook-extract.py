#!/usr/bin/python3
"""Bounded XLSX-to-data worker. Never run without the mandatory Linux sandbox.

Only stdin carries file bytes; stdout carries one JSON result. Import everything
before installing seccomp: afterwards even opening a library or /etc file fails.
The process has no ERP credentials, file handles, network, exec or fork authority.
"""

import csv
import ctypes
import datetime
import encodings.cp437  # ZIP's legacy filename codec must be loaded pre-sandbox.
import encodings.utf_8_sig
import errno
import hashlib
import io
import json
import math
import os
import re
import resource
import socket
import stat
import sys
import zipfile
import xml.etree.ElementTree as ET
import zlib  # Load the extension before filesystem access is removed.

POLICY_VERSION = "xlsx-static-seccomp-v1"
MAX_INPUT = 5_000_000
MAX_ENTRY = 10_000_000
MAX_EXPANDED = 25_000_000
MAX_ENTRIES = 200
MAX_CELLS = 50_000
MAX_ROWS = 25_000
MAX_COLUMNS = 200
MAX_MATRIX = 1_000_000
MAX_CELL = 4_000
MAX_CSV = 2_000_000
MAX_XML_ELEMENTS = 250_000
MAX_XML_DEPTH = 64
SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
RID_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


class Rejected(ValueError):
    """Unsupported or malformed input, with a bounded, source-free reason."""


def install_sandbox() -> None:
    """Install irreversible syscall restrictions and resource limits or fail."""
    if sys.platform != "linux":
        raise RuntimeError("Linux isolation is required")
    # Do not assume the parent has only low descriptors. A leaked high file
    # descriptor would otherwise remain readable through a file-backed mapping.
    for name in os.listdir("/proc/self/fd"):
        descriptor = int(name)
        if descriptor > 2:
            try:
                os.close(descriptor)
            except OSError as error:
                if error.errno != errno.EBADF:
                    raise
    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))
    resource.setrlimit(resource.RLIMIT_NOFILE, (16, 16))
    lib = ctypes.CDLL("libseccomp.so.2", use_errno=True)
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
    lib.seccomp_rule_add_array.argtypes = [
        ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint,
        ctypes.c_void_p,
    ]
    lib.seccomp_rule_add_array.restype = ctypes.c_int
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_load.restype = ctypes.c_int
    lib.seccomp_release.argtypes = [ctypes.c_void_p]

    class Compare(ctypes.Structure):
        _fields_ = [
            ("arg", ctypes.c_uint), ("op", ctypes.c_int),
            ("a", ctypes.c_uint64), ("b", ctypes.c_uint64),
        ]

    allow = 0x7FFF0000
    ctx = lib.seccomp_init(0x00050000 | errno.EPERM)
    if not ctx:
        raise RuntimeError("cannot initialize isolation")
    try:
        def permit(name, arg=None, value=0, mask=None):
            number = lib.seccomp_syscall_resolve_name(name.encode("ascii"))
            if number < 0:
                return
            comparison = None
            if arg is not None:
                # SCMP_CMP_EQ=4, SCMP_CMP_MASKED_EQ=7.
                comparison = Compare(arg, 4 if mask is None else 7,
                                     value if mask is None else mask,
                                     0 if mask is None else value)
            count = 0 if comparison is None else 1
            pointer = None if comparison is None else ctypes.byref(comparison)
            if lib.seccomp_rule_add_array(ctx, allow, number, count, pointer) != 0:
                raise RuntimeError("cannot configure isolation")

        for name in (
            "close", "fstat", "newfstatat", "lseek", "brk", "munmap",
            "mremap", "madvise", "futex", "futex_time64", "clock_gettime",
            "clock_gettime64", "gettimeofday", "getrusage", "getpid", "gettid",
            "rt_sigaction", "rt_sigprocmask", "rt_sigreturn", "sigaltstack",
            "sched_yield", "exit", "exit_group", "restart_syscall",
        ):
            permit(name)
        permit("read", 0, 0)
        permit("write", 0, 1)
        permit("write", 0, 2)
        # No executable mappings. No open/openat, socket/connect, exec, fork,
        # clone, ptrace, ioctl, io_uring, or seccomp/prctl modification allowed.
        for name in ("mmap", "mmap2"):
            number = lib.seccomp_syscall_resolve_name(name.encode("ascii"))
            if number >= 0:
                comparisons = (Compare * 2)(Compare(2, 7, 4, 0), Compare(3, 7, 0x20, 0x20))
                if lib.seccomp_rule_add_array(ctx, allow, number, 2, comparisons) != 0:
                    raise RuntimeError("cannot configure memory isolation")
        if lib.seccomp_load(ctx) != 0:
            raise RuntimeError("cannot activate isolation")
    finally:
        lib.seccomp_release(ctx)


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_xml(data: bytes) -> ET.Element:
    try:
        text = data.decode("utf-8-sig", errors="strict")
    except UnicodeError as error:
        raise Rejected("xml_encoding") from error
    if "\x00" in text or re.search(r"<!\s*(?:DOCTYPE|ENTITY)\b", text, re.I):
        raise Rejected("xml_entities")
    # Bound allocation as the tree is constructed, not after full parsing.
    parser = ET.XMLPullParser(events=("start", "end"))
    depth = count = 0
    root = None
    try:
        for offset in range(0, len(text), 8192):
            parser.feed(text[offset:offset + 8192])
            for event, node in parser.read_events():
                if event == "start":
                    if root is None:
                        root = node
                    count += 1
                    depth += 1
                    if count > MAX_XML_ELEMENTS or depth > MAX_XML_DEPTH:
                        raise Rejected("xml_budget")
                else:
                    depth -= 1
        parser.close()
    except ET.ParseError as error:
        raise Rejected("xml_malformed") from error
    if root is None or depth:
        raise Rejected("xml_malformed")
    return root


def unpack(data: bytes) -> tuple[dict[str, ET.Element], set[str]]:
    if not data or len(data) > MAX_INPUT or not data.startswith(b"PK\x03\x04"):
        raise Rejected("workbook_size_or_signature")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        infos = archive.infolist()
        if not infos or len(infos) > MAX_ENTRIES:
            raise Rejected("zip_entry_budget")
        declared = actual = 0
        seen = set()
        documents = {}
        for info in infos:
            name = info.filename
            lower = name.lower()
            if (not name or "\\" in name or name.startswith("/") or
                    any(part in ("", ".", "..") for part in name.rstrip("/").split("/")) or
                    ":" in name or any(ord(char) < 32 for char in name) or lower in seen):
                raise Rejected("zip_entry_path")
            seen.add(lower)
            if info.flag_bits & 1 or stat.S_ISLNK(info.external_attr >> 16):
                raise Rejected("zip_encrypted_or_link")
            if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise Rejected("zip_compression")
            declared += info.file_size
            if (info.file_size > MAX_ENTRY or declared > MAX_EXPANDED or
                    info.file_size > max(info.compress_size, 1) * 100):
                raise Rejected("zip_expansion_budget")
            if any(part in lower for part in (
                "vbaproject", "macrosheet", "dialogsheet", "externallink",
                "embedding", "activex", "customui", "comment", "threadedcomment",
                "connection", "querytable",
            )) or lower.endswith((".bin", ".exe", ".dll", ".vbs", ".js")):
                raise Rejected("workbook_active_or_hidden_content")
            if info.is_dir():
                continue
            # This alpha profile accepts XML package parts and static raster
            # thumbnails only. Unknown binary parts never become implicitly safe.
            if not lower.endswith((".xml", ".rels", ".png", ".jpeg", ".jpg")):
                raise Rejected("workbook_unsupported_part")
            chunks = []
            entry_size = 0
            with archive.open(info) as entry:
                while True:
                    chunk = entry.read(64 * 1024)
                    if not chunk:
                        break
                    entry_size += len(chunk)
                    actual += len(chunk)
                    if entry_size > MAX_ENTRY or actual > MAX_EXPANDED:
                        raise Rejected("zip_expansion_budget")
                    chunks.append(chunk)
            if entry_size != info.file_size:
                raise Rejected("zip_size_mismatch")
            raw = b"".join(chunks)
            if lower.endswith((".xml", ".rels")):
                root = parse_xml(raw)
                for node in root.iter():
                    kind = local_name(node.tag)
                    if kind in ("f", "formula", "formula1", "formula2", "definedName"):
                        raise Rejected("workbook_formula_requires_values_only_copy")
                    if kind in ("connection", "queryTable", "externalBook", "oleObject", "control", "webPr"):
                        raise Rejected("workbook_active_or_hidden_content")
                if lower == "[content_types].xml":
                    for node in root:
                        content_type = node.attrib.get("ContentType", "").lower()
                        if any(s in content_type for s in ("macro", "activex", "oleobject")):
                            raise Rejected("workbook_active_content_type")
                if lower.endswith(".rels"):
                    for node in root:
                        target = node.attrib.get("Target", "")
                        kind = node.attrib.get("Type", "").lower()
                        if node.attrib.get("TargetMode", "").lower() == "external" or re.match(r"(?:[a-z][a-z0-9+.-]*:|//)", target, re.I):
                            raise Rejected("workbook_external_relationship")
                        if any(s in kind for s in ("oleobject", "activex", "vba", "externallink", "connection", "querytable")):
                            raise Rejected("workbook_active_relationship")
                if lower in ("xl/workbook.xml", "xl/_rels/workbook.xml.rels",
                             "xl/sharedstrings.xml", "xl/styles.xml") or lower.startswith("xl/worksheets/"):
                    documents[name] = root
        archive.close()
        return documents, seen
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError, EOFError, zlib.error) as error:
        raise Rejected("zip_malformed") from error


def bounded_text(node: ET.Element) -> str:
    if node.tag not in ("{%s}si" % SHEET_NS, "{%s}is" % SHEET_NS):
        raise Rejected("workbook_string_structure")
    values = []
    for child in node:
        if child.tag == "{%s}t" % SHEET_NS and not len(child):
            values.append(child.text or "")
        elif child.tag == "{%s}r" % SHEET_NS:
            for part in child:
                if part.tag == "{%s}t" % SHEET_NS and not len(part):
                    values.append(part.text or "")
                elif part.tag != "{%s}rPr" % SHEET_NS:
                    raise Rejected("workbook_string_structure")
        else:
            raise Rejected("workbook_string_structure")
    value = "".join(values)
    if len(value.encode("utf-8")) > MAX_CELL:
        raise Rejected("cell_budget")
    return value


def date_styles(styles: ET.Element | None) -> set[int]:
    if styles is None:
        return set()
    custom = {}
    for node in styles.iter():
        if local_name(node.tag) == "numFmt":
            custom[int(node.attrib.get("numFmtId", "0"))] = node.attrib.get("formatCode", "")
    result = set()
    xfs = styles.find("{%s}cellXfs" % SHEET_NS)
    for index, node in enumerate(xfs if xfs is not None else []):
        number = int(node.attrib.get("numFmtId", "0"))
        code = re.sub(r'"[^\"]*"|\[[^\]]*\]|\\.', "", custom.get(number, "")).lower()
        if 14 <= number <= 22 or 45 <= number <= 47 or re.search("[ymdhis]", code):
            result.add(index)
    return result


def extract(data: bytes) -> dict[str, str]:
    documents, seen = unpack(data)
    required = ("[content_types].xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels")
    if not all(name in seen for name in required):
        raise Rejected("workbook_required_parts")
    workbook = documents.get("xl/workbook.xml")
    relationships = documents.get("xl/_rels/workbook.xml.rels")
    if workbook is None or relationships is None or workbook.tag != "{%s}workbook" % SHEET_NS:
        raise Rejected("workbook_structure")
    sheets = workbook.findall("{%s}sheets/{%s}sheet" % (SHEET_NS, SHEET_NS))
    worksheet_names = [name for name in documents if re.fullmatch(r"xl/worksheets/[^/]+\.xml", name)]
    if len(sheets) != 1 or len(worksheet_names) != 1 or sheets[0].attrib.get("state", "visible") != "visible":
        raise Rejected("workbook_single_visible_sheet_required")
    rel_id = sheets[0].attrib.get("{%s}id" % RID_NS)
    refs = [node for node in relationships if node.attrib.get("Id") == rel_id]
    if len(refs) != 1 or not refs[0].attrib.get("Type", "").endswith("/worksheet"):
        raise Rejected("workbook_sheet_relationship")
    target = refs[0].attrib.get("Target", "")
    target = target[1:] if target.startswith("/") else "xl/" + target
    if target != worksheet_names[0]:
        raise Rejected("workbook_sheet_relationship")
    sheet = documents[target]
    if sheet.tag != "{%s}worksheet" % SHEET_NS:
        raise Rejected("workbook_sheet_structure")
    strings_root = documents.get("xl/sharedStrings.xml")
    if strings_root is not None and strings_root.tag != "{%s}sst" % SHEET_NS:
        raise Rejected("workbook_string_structure")
    strings = [] if strings_root is None else [bounded_text(node) for node in strings_root]
    if len(strings) > MAX_CELLS:
        raise Rejected("shared_strings_budget")
    styles = date_styles(documents.get("xl/styles.xml"))
    properties = workbook.find("{%s}workbookPr" % SHEET_NS)
    dates1904 = properties is not None and properties.attrib.get("date1904") in ("1", "true")
    rows = {}
    coordinates = set()
    width = count = 0
    data_nodes = sheet.findall("{%s}sheetData" % SHEET_NS)
    if len(data_nodes) != 1:
        raise Rejected("workbook_sheet_structure")
    canonical_cells = set()
    for row_node in data_nodes[0]:
        if row_node.tag != "{%s}row" % SHEET_NS:
            raise Rejected("workbook_sheet_structure")
        for cell in row_node:
            if cell.tag == "{%s}c" % SHEET_NS:
                canonical_cells.add(cell)
    for node in sheet.iter():
        kind = local_name(node.tag)
        if kind in ("row", "col") and node.attrib.get("hidden") in ("1", "true"):
            raise Rejected("workbook_hidden_dimensions")
        if kind != "c":
            continue
        if node not in canonical_cells:
            raise Rejected("workbook_sheet_structure")
        count += 1
        if count > MAX_CELLS:
            raise Rejected("cell_count_budget")
        reference = node.attrib.get("r", "")
        match = re.fullmatch(r"([A-Z]+)([1-9][0-9]*)", reference)
        if not match or reference in coordinates:
            raise Rejected("cell_coordinate")
        coordinates.add(reference)
        column = 0
        for char in match[1]:
            column = column * 26 + ord(char) - 64
            if column > MAX_COLUMNS:
                raise Rejected("column_budget")
        row = int(match[2])
        if row > MAX_ROWS:
            raise Rejected("row_budget")
        if any(local_name(child.tag) == "f" for child in node):
            raise Rejected("workbook_formula_requires_values_only_copy")
        value_nodes = node.findall("{%s}v" % SHEET_NS)
        if len(value_nodes) > 1:
            raise Rejected("workbook_cell_structure")
        value_node = value_nodes[0] if value_nodes else None
        value = "" if value_node is None else value_node.text or ""
        cell_type = node.attrib.get("t", "n")
        if cell_type == "inlineStr":
            inline = node.findall("{%s}is" % SHEET_NS)
            if len(inline) != 1:
                raise Rejected("workbook_string_structure")
            value = bounded_text(inline[0])
        elif cell_type == "s":
            if not value.isdecimal() or int(value) >= len(strings):
                raise Rejected("shared_string_reference")
            value = strings[int(value)]
        elif cell_type == "b":
            if value not in ("0", "1"):
                raise Rejected("boolean_cell")
            value = "TRUE" if value == "1" else "FALSE"
        elif cell_type == "e":
            raise Rejected("workbook_error_cell")
        elif cell_type not in ("n", "str", "d"):
            raise Rejected("unsupported_cell_type")
        elif cell_type == "n" and int(node.attrib.get("s", "-1")) in styles and value:
            serial = float(value)
            if not math.isfinite(serial):
                raise Rejected("date_cell")
            epoch = datetime.datetime(1904, 1, 1) if dates1904 else datetime.datetime(1899, 12, 30)
            date = epoch + datetime.timedelta(days=serial)
            value = date.date().isoformat() if serial.is_integer() else date.isoformat(timespec="milliseconds").replace(".000", "") + "Z"
        if len(value.encode("utf-8")) > MAX_CELL or "\x00" in value:
            raise Rejected("cell_budget")
        rows.setdefault(row, {})[column - 1] = value
        width = max(width, column)
        if len(rows) * width > MAX_MATRIX:
            raise Rejected("matrix_budget")
    matrix = [[columns.get(i, "") for i in range(width)] for _, columns in sorted(rows.items())]
    matrix = [row for row in matrix if any(cell.strip() for cell in row)]
    if not matrix or not matrix[0]:
        raise Rejected("header_required")
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n", quoting=csv.QUOTE_ALL)
    writer.writerows(matrix)
    csv_text = output.getvalue()
    if len(csv_text.encode("utf-8")) > MAX_CSV:
        raise Rejected("csv_output_budget")
    sheet_name = sheets[0].attrib.get("name", "Sheet 1")
    if len(sheet_name.encode("utf-8")) > 255:
        raise Rejected("sheet_name_budget")
    return {"csvText": csv_text, "sheetName": sheet_name,
            "sourceSha256": hashlib.sha256(data).hexdigest(),
            "policyVersion": POLICY_VERSION}


def probe() -> dict[str, bool]:
    """Verify actual kernel denials in a disposable test process."""
    results = {}
    for name, action in (
        ("filesystem", lambda: os.open("/etc/passwd", os.O_RDONLY)),
        ("network", lambda: socket.socket(socket.AF_INET, socket.SOCK_STREAM)),
        ("process", os.fork),
        ("exec", lambda: os.execv("/bin/true", ["true"])),
    ):
        try:
            action()
            results[name] = False
        except PermissionError:
            results[name] = True
    try:
        os.fstat(5000)
        results["inherited_fd_closed"] = False
    except OSError as error:
        results["inherited_fd_closed"] = error.errno == errno.EBADF
    return results


def main() -> int:
    try:
        install_sandbox()
    except Exception:
        sys.stdout.write('{"error":"isolation_unavailable"}\n')
        return 78
    try:
        if sys.argv[1:] == ["--probe"]:
            result = probe()
            if not all(result.values()):
                raise RuntimeError("isolation probe failed")
        elif sys.argv[1:]:
            raise Rejected("invalid_protocol")
        else:
            result = extract(sys.stdin.buffer.read(MAX_INPUT + 1))
        sys.stdout.write(json.dumps(result, ensure_ascii=True, separators=(",", ":")) + "\n")
        return 0
    except Rejected as error:
        sys.stdout.write(json.dumps({"error": str(error)}) + "\n")
        return 65
    except Exception:
        # Never echo filenames, XML snippets, paths, source bytes or tracebacks.
        sys.stdout.write('{"error":"workbook_malformed"}\n')
        return 65


if __name__ == "__main__":
    raise SystemExit(main())
