"""Convert the official PostgreSQL Exercises COPY data to local SQLite."""

import argparse
import re
import sqlite3
from pathlib import Path


TABLES = {
    "facilities": (
        "facid INTEGER PRIMARY KEY, name TEXT, membercost REAL, guestcost REAL, "
        "initialoutlay REAL, monthlymaintenance REAL",
        ("facid", "name", "membercost", "guestcost", "initialoutlay", "monthlymaintenance"),
        (int, str, float, float, float, float),
    ),
    "members": (
        "memid INTEGER PRIMARY KEY, surname TEXT, firstname TEXT, address TEXT, "
        "zipcode INTEGER, telephone TEXT, recommendedby INTEGER, joindate TEXT",
        ("memid", "surname", "firstname", "address", "zipcode", "telephone", "recommendedby", "joindate"),
        (int, str, str, str, int, str, int, str),
    ),
    "bookings": (
        "bookid INTEGER PRIMARY KEY, facid INTEGER, memid INTEGER, starttime TEXT, slots INTEGER",
        ("bookid", "facid", "memid", "starttime", "slots"),
        (int, int, int, str, int),
    ),
}


def copy_blocks(source: str):
    lines = iter(source.splitlines())
    for line in lines:
        if not line.startswith("COPY "):
            continue
        match = re.fullmatch(r"COPY (\w+) \(([^)]+)\) FROM stdin;", line)
        if match is None or match.group(1) not in TABLES:
            raise ValueError(f"unknown COPY block: {line}")
        name = match.group(1)
        columns = tuple(part.strip() for part in match.group(2).split(","))
        if columns != TABLES[name][1]:
            raise ValueError(f"unexpected columns for {name}: {columns}")
        rows = []
        for row in lines:
            if row == r"\.":
                break
            fields = row.split("\t")
            if len(fields) != len(columns):
                raise ValueError(f"wrong field count in {name}")
            if any("\\" in field and field != r"\N" for field in fields):
                raise ValueError(f"unsupported COPY escape in {name}")
            rows.append(tuple(
                None if field == r"\N" else convert(field)
                for field, convert in zip(fields, TABLES[name][2])
            ))
        else:
            raise ValueError(f"unfinished COPY block: {name}")
        yield name, rows


def insert_statements(source: str):
    """Yield the INSERT statements of the current official dump."""
    buffer = ""
    for line in source.splitlines(keepends=True):
        if not buffer and not line.startswith("INSERT INTO "):
            continue
        buffer += line
        if sqlite3.complete_statement(buffer):
            yield buffer
            buffer = ""


def main():
    directory = Path(__file__).parent / "data"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, nargs="?", default=directory / "clubdata.sql")
    parser.add_argument("output", type=Path, nargs="?", default=directory / "club.sqlite3")
    args = parser.parse_args()
    if args.output.exists():
        parser.error(f"output already exists: {args.output}")

    source = args.source.read_text(encoding="utf-8")
    # The older dump uses COPY blocks; the current one uses INSERT statements.
    blocks = dict(copy_blocks(source))
    inserts = [] if blocks else list(insert_statements(source))
    if blocks and set(blocks) != set(TABLES) or not blocks and not inserts:
        raise ValueError(f"expected data for {', '.join(TABLES)}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(args.output) as db:
        for name, (schema, columns, _) in TABLES.items():
            db.execute(f'CREATE TABLE "{name}" ({schema})')
            if not blocks:
                continue
            placeholders = ", ".join("?" for _ in columns)
            db.executemany(f'INSERT INTO "{name}" VALUES ({placeholders})', blocks[name])
            print(f"{name}: {len(blocks[name])} rows")
        for statement in inserts:
            db.execute(statement)
        for name in TABLES:
            if not blocks:
                print(f"{name}: {db.execute(f'SELECT count(*) FROM {name}').fetchone()[0]} rows")
        db.execute("CREATE INDEX bookings_facid ON bookings(facid)")
        db.execute("CREATE INDEX bookings_memid ON bookings(memid)")


if __name__ == "__main__":
    main()
